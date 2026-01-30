
// 版本号全局变量声明
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

import React, { useState, useRef, useEffect, useMemo, createContext, useContext, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { FixedTooltipProvider } from '@/components/FixedTooltip';
import ScriptToolApp from '@/apps/script-split/ScriptToolApp';
import { AIToolsDirectoryApp } from '@/apps/ai-tools';
import AIImageEditorApp from '@/apps/ai-image-editor/AIImageEditorApp';
import { Layer, Tool as MagicTool } from './apps/ai-image-editor/types';
import PromptToolApp from '@/apps/prompt-tool/PromptToolApp';
import SheetMindApp from '@/apps/sheetmind/SheetMindApp';
import AICopyDeduplicatorApp from '@/apps/ai-copy-deduplicator/AICopyDeduplicatorApp';
import ProDedupApp from '@/apps/ai-copy-deduplicator/ProDedupApp';
import { MindMapApp } from '@/apps/ai-mind-map';
import { SheetMindState, initialSheetMindState } from '@/apps/sheetmind/types';

// 新版反推提示词模块（合并了正式版和创艺魔盒 2 的功能）
import { ImageToPromptApp } from '@/apps/image-to-prompt';

type MagicCanvasState = {
  layers: Layer[];
  activeLayerId: string | null;
  prompt: string;
  tool: MagicTool;
  brushColor: string;
  brushSize: number;
  cropBox: { x: number; y: number; width: number; height: number } | null;
  canvasSize: { width: number; height: number } | null;
  isLayerPanelOpen: boolean;
  isRightPanelCollapsed: boolean;
  promptMode: 'generate' | 'edit';
  isPromptExpanded: boolean;
  chatHistory: { role: 'user' | 'model'; text: string }[];
  chatInput: string;
};

const initialMagicCanvasState: MagicCanvasState = {
  layers: [],
  activeLayerId: null,
  prompt: '',
  tool: 'move',
  brushColor: '#EF4444',
  brushSize: 20,
  cropBox: null,
  canvasSize: null,
  isLayerPanelOpen: true,
  isRightPanelCollapsed: false,
  promptMode: 'generate',
  isPromptExpanded: false,
  chatHistory: [],
  chatInput: '',
};
import ImageRecognitionApp from '@/apps/ai-image-recognition/ImageRecognitionApp';
import { ImageRecognitionState, initialImageRecognitionState } from '@/apps/ai-image-recognition/types';
import SmartTranslateApp, { SmartTranslateState, initialSmartTranslateState } from '@/apps/smart-translate/SmartTranslateApp';
import ConfirmDialog from '@/components/ConfirmDialog';
import SubEmailGenerator from '@/apps/sub-email/SubEmailGenerator';
import { Clock, Loader2, Check, X, Image, Palette, Lightbulb, ClipboardList, Sparkles, AlertCircle, Key, HelpCircle, RefreshCw, Settings, AlertTriangle, Globe, Bot } from 'lucide-react';
import HelpCenter from '@/components/HelpCenter';
import FeedbackModal from '@/components/FeedbackModal';
import { UpdateNotice, hasNewUpdate, markUpdateAsSeen } from '@/components/UpdateNotice';
import { TutorialModal } from '@/components/TutorialModal';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ModelProvider, MODEL_ROUTES, MODEL_LABELS, ModelMode } from '@/contexts/ModelContext';
import LoginModal from '@/components/LoginModal';
import CloudSyncPanel from '@/components/CloudSyncPanel';
import { SyncStatus, getSavedSyncEmail, saveSyncEmail, debouncedPush, extractSyncableData, pullFromCloud, mergeCloudDataToImages, flushPendingSync } from '@/services/cloudSyncService';
import { saveUserSettings, loadUserSettings, savePresets, loadPresets, saveTemplates, loadTemplates, saveApiKeys, loadApiKeys } from '@/services/firestoreService';
import { flushPendingSaves } from '@/services/projectService';
import { fetchUserPresetsFromSheet, savePresetRowsToSheet } from './services/presetSheetService';
import {
  SHARED_PRESET_SHEET_CONFIG,
  PRESET_SCOPE_TEMPLATE,
  encodeScopedCategory,
  extractScopedRows
} from './services/presetSheetConfig';
import { getShouldSkipPresetSaveConfirm, setShouldSkipPresetSaveConfirm } from './services/presetPreferences';
import { fetchImageBlob, processImageUrl, decodeHtmlEntities } from '@/apps/ai-image-recognition/utils';

declare var ExcelJS: any;

// Error Boundary Component
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, errorInfo: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', fontFamily: 'monospace', backgroundColor: '#fee', margin: '20px', borderRadius: '8px' }}>
          <h1 style={{ color: '#c00' }}>应用错误</h1>
          <h2>Something went wrong</h2>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: '20px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>错误详情</summary>
            <p><strong>Error:</strong> {this.state.error && this.state.error.toString()}</p>
            <p><strong>Stack:</strong></p>
            <pre>{this.state.error && this.state.error.stack}</pre>
            {this.state.errorInfo && (
              <>
                <p><strong>Component Stack:</strong></p>
                <pre>{this.state.errorInfo.componentStack}</pre>
              </>
            )}
          </details>
          <button onClick={() => window.location.reload()} style={{ marginTop: '20px', padding: '10px 20px', cursor: 'pointer' }}>
            重新加载页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- App Contexts (API, i18n, Theme) ---
const translations = {
  en: {
    appTitle: "AI Creative Toolkit",
    navPrompt: "Prompt Deconstructor",
    navTranslate: "Smart Translate",
    navStudio: "AI One-Click Retouch",
    navDesc: "Prompt Tool",
    navTemplate: "Instruction Template",
    navScriptTool: "Script Split",
    navMagicCanvas: "AI Image Editor",
    navImageRecognition: "AI Image Recognition",
    navSheetMind: "SheetMind",
    navCopyDedup: "AI Copy Deduplicator",
    navProDedup: "Pro Dedup Search",
    navMindMap: "AI Mind Map",
    navAIToolsDirectory: "AI Tools",
    navOpalBatch: "Opal Batch Image",
    // Prompt Tool
    promptTitle: "Image to Prompt",
    promptDescription: "Batch upload images and use multi-turn chat to refine prompts for each image independently.",
    clearHistory: "Clear History",
    exportAll: "Export All Records",
    exporting: "Exporting...",
    newSession: "+ New Session",
    selectExperts: "1. Select AI Drawing Expert Models (multi-select):",
    uploadPrompt: "2. Drag to upload, double-click to choose files, or paste an image",
    stagingTitle: "Preparing to Process ({count} images)",
    appendImages: "Add More Images",
    startPrompting: "Start Prompting",
    processing: "Processing...",
    preModificationPlaceholder: "Enter modification instructions (optional)",
    mergedPrompts: "Merged Prompts",
    exportExcel: "Export Excel",
    allEnglishPrompts: "All English Prompts",
    allChinesePrompts: "All Chinese Prompts",
    reGenerate: "Re-generate",
    retryAllFailed: "Retry All Failed",
    sendMessage: "Send",
    chatPlaceholder: "Continue conversation to modify or optimize...",
    uploadFromComputer: "Upload from Computer",
    uploadFromDrive: "Upload from Google Drive",
    uploadFromDrive_tooltip: "Google Drive integration is coming soon.",
    // Translate Tool
    translateTitle: "Smart Translate",
    translatePlaceholder: "Enter text or upload an image to translate...",
    translateButton: "Translate Text",
    uploadAndTranslate: "or Upload Image to recognize and translate",
    originalText: "Original",
    translatedText: "Translated",
    // Image Studio Tool (Formerly Portrait)
    studioTitle: "Image Studio",
    studioDescription: "AI-powered image retouching. Upload a photo, choose beautification options, enter custom instructions, or remove objects.",
    uploadSingleImage: "Click or drag an image here to upload, or paste an image",
    options: "Options",
    mattingOption1: "Remove background, keep subject",
    mattingOption2: "Remove foreground, keep background",
    mattingOption3: "Remove selected area",
    mattingCustomPlaceholder: "Custom object to remove",
    execute: "Execute",
    download: "Download",
    undo: "Undo",
    redo: "Redo",
    originalImage: "Original",
    processedImage: "Processed",
    sendToPortrait: 'Send to Portrait Retouching', // This key might be unused now but kept for safety
    selectArea: 'Select Area',
    brush: 'Brush',
    brushSize: "Brush Size",
    clearSelection: 'Clear Selections',
    reset: 'Reset',
    tabRetouch: "Basic Retouch",
    tabOutfit: "Outfit Change",
    tabPortrait: "Portrait Retouching",
    tabBackground: "Background",
    tabFilter: "Filter",
    tabMatting: "Smart Matting",
    tabGeneral: "Custom Edit",
    customPlaceholder: "Enter custom instructions, or click '+' to add as a preset",
    addPreset: "Add as preset",
    generalCustomPrompt: "Enter any modifications you want, e.g., 'add a pair of glasses', 'adjust the lighting to a warm evening tone'...",
    generalCustomPlaceholder: "Enter custom instructions here...",
    exportPresets: "Export Presets",
    importPresets: "Import Presets",
    presetUserLabel: "Preset user",
    presetUserPlaceholder: "Name in Google Sheet",
    presetSync: "Sync from sheet",
    presetSyncing: "Syncing...",
    presetSheetDescription: "Defaults read presets from Google Sheet by user; you can still import/export JSON.",
    presetSyncSuccess: "Loaded {count} presets from sheet.",
    presetSaveToSheet: "Save presets to sheet",
    presetSaving: "Saving...",
    presetSaveSuccess: "Presets saved to the sheet.",
    presetSaveError: "Failed to save presets, please try again.",
    presetSaveNoData: "No presets available to save.",
    presetSaveConfirmTitle: "Overwrite sheet presets?",
    presetSaveConfirmDesc: "This will overwrite all presets stored for {user} in the shared Google Sheet.",
    presetSaveConfirmDontAsk: "Don't remind me again",
    presetSaveConfirmConfirm: "Save now",
    presetSaveStudio: "Save Image Studio presets",
    presetSaveMagic: "Save Magic commands",
    presetSaveTemplate: "Save innovation templates",
    presetSheetEmpty: "No presets found for this user; default presets kept.",
    presetUserRequired: "Please fill the preset user name first.",
    presetGlobalExport: "Export all presets",
    presetGlobalImport: "Import all presets",
    presetUserHint: "Must use a valid email address to avoid collisions.",
    presetUserMustBeGmail: "Preset username must be a valid email address.",
    renameCategory: "Rename Category",
    deleteCategory: "Delete Category",
    addCategory: "Add New Category",
    categoryInputPlaceholder: "Enter name & press Enter",
    editPreset: "Edit Instruction",
    presetLabelPlaceholder: "Instruction Name",
    presetPromptPlaceholder: "Instruction Content",
    save: "Save",
    cancel: "Cancel",

    // General
    copied: "Copied!",
    copy: "Copy",
    info_resolution_warning: "Note: The AI processes images at a standard resolution (~1024px). High-resolution images will be downscaled, which may affect output quality.",
    error_selectExpert: "Please select at least one AI drawing expert model.",
    error_failedToAnalyze: "Failed to analyze images.",
    error_retryFailed: "Failed to re-analyze image.",
    error_sendMessage: "Failed to send message.",
    error_exportExcel: "Failed to export to Excel.",
    error_exportAll: "Failed to export all records.",
    alert_noRecords: "No session records to export.",
    error_translationFailed: "Translation failed, please try again later.",
    error_ocrFailed: "Image text recognition failed.",
    error_invalidPrompt: "Please enter or select a valid instruction.",
    error_invalidImageFormat: "Invalid image format, cannot continue editing.",
    error_imageGenFailed: "AI failed to generate an image, please try another instruction.",
    error_safetyPolicy: "The instruction may violate the safety policy (e.g., involves real locations or sensitive events). Please try using more generic terms.",
    error_imageEditFailed: "Image editing failed, please try again later.",
    error_rateLimit: "Request frequency is too high, quota has been exceeded.",
    apiKeyTitle: "API Key Settings",
    apiKeyButtonLabel: "API Key",
    apiKeyPrompt: "Your API key is stored locally. When logged in, it syncs to cloud. Website version supports multi-key auto-rotation.",
    apiKeyInputPlaceholder: "Enter your Google AI API key",
    error_apiKeyNotSet: "API Key not set. Please set your key by clicking the 'API Key' button in the top right.",
    copyAllPrompts: "Copy All Prompts",
    copyActivePrompts: "Copy Current Prompts",
    copyAllInnovationPrompts: "Copy All Innovation Prompts",
    copyActiveInnovationPrompts: "Copy Current Innovation Prompts",
    copyInnovationWithSource: "Copy With Source",
    copyInnovationResultOnly: "Copy Result Only",
    showInlineDescPanel: "Show Innovation Panel",
    hideInlineDescPanel: "Hide Innovation Panel",
    openFullDescTool: "Open Description Innovator",
    showChinesePrompts: "Show Chinese prompts",
    hideChinesePrompts: "Hide Chinese prompts",
    showAllChinesePrompts: "Show all Chinese prompts",
    hideAllChinesePrompts: "Hide all Chinese prompts",
    // Sub Email Tool
    subEmailTitle: "Sub Email Generator",
    subEmailDescription: "Enter a Gmail address, select how many variants to create (or all), and optionally generate passwords.",
    subEmailEmailLabel: "Original Gmail Address",
    subEmailEmailPlaceholder: "youxiangzhanghao222@gmail.com",
    subEmailVariantsLabel: "Variants (1, 5, all)",
    subEmailVariantsHelper: "Leave empty or type all to generate every combination, default is 5.",
    subEmailGeneratePasswords: "Also generate random passwords",
    subEmailPasswordLength: "Password length",
    subEmailIncludeSymbols: "Include symbols (!@#$%^&*...)",
    subEmailAvoidAmbiguous: "Avoid ambiguous characters (i, l, I, O, 1, 0)",
    subEmailMaxLimit: "Safety cap (max rows)",
    subEmailGenerateButton: "Generate variants",
    subEmailResultsTitle: "Results",
    subEmailColumnEmail: "Email",
    subEmailColumnPassword: "Password",
    subEmailSummaryAll: "Produced all possible variants (cap {limit}), total {count} rows.",
    subEmailSummaryPartial: "{count} variants generated (safety cap {limit}).",
    subEmailNoVariants: "No new variants were generated; the original address is already listed.",
    subEmailLimitNotice: "Requested count exceeded the safety cap and was reduced to {limit}.",
    subEmailErrorInvalidEmail: "Please enter a valid Gmail address (e.g. youxiangzhanghao222@gmail.com).",
    subEmailErrorVariants: "Variant count must be a positive integer or 'all'.",
    subEmailCopyRow: "Copy",
    subEmailCopyAll: "Copy All",
    // Description Innovator Tool
    descTitle: "Prompt Innovator",
    descDescription: "Transform existing prompts into richer variations using your custom instruction template.",
    descPromptLabel: "Instruction template",
    descPromptPlaceholder: "Paste the long-form instruction set that Gemini should always follow when expanding descriptions.",
    descCountLabel: "Variants per description",
    descSplitCharLabel: "Auto split delimiter",
    descBulkLabel: "Bulk add descriptions",
    descBulkPlaceholder: "Paste one description per line. Blank lines will be ignored.",
    descBulkAdd: "Add lines",
    descAddEntry: "+ Description",
    descRemoveSelected: "Remove selected",
    descClearAll: "Remove all entries",
    descGenerateAll: "Generate all",
    descRunEntry: "Generate",
    descRemoveEntry: "Remove",
    descEntryPlaceholder: "Enter the base description you want to innovate on...",
    descOutputsLabel: "Generated variations",
    descNoOutputs: "No output yet.",
    descStatusIdle: "Waiting",
    descStatusProcessing: "Processing...",
    descStatusSuccess: "Completed",
    descStatusError: "Failed",
    descCopyAll: "Copy all",
    descCopyBatch: "Copy all outputs",
    descErrorNoInput: "Please enter at least one description before generating.",
    descPause: "Pause",
    descResume: "Resume",
    descStop: "Stop",
    descPauseNotice: "Processing paused. The requests already sent will finish, and the remaining entries are waiting in the queue.",
    descStopNotice: "Stop requested. The requests already sent will finish, and the remaining queue has been halted.",
    descInlineSourceLabel: "Base prompt",
    descInlineNoResults: "No innovations have been generated for this image yet.",
    descChineseHiddenHint: "Chinese outputs are hidden. Click \"Show Chinese prompts\" to reveal translations.",
    descInlineSelectImage: "Select an image to view its innovations.",
    descCollapseEntries: "Collapse entries list",
    descExpandEntries: "Expand entries list",
    descEntriesHidden: "Descriptions are hidden to keep the view compact; expand to review the outputs.",
    templateTitle: "Innovation Instruction Template Builder",
    templateDescription: "Break the mega instruction into editable sections, tweak what you need, and copy the combined result when you're ready.",
    templateVersionLabel: "Version",
    templateNewVersionPlaceholder: "Name this version (e.g., 'General' or 'Holiday')",
    templateSaveVersion: "Save Version",
    templateOverwriteVersion: "Update Version",
    templateDeleteVersion: "Delete Version",
    templateRenameVersion: "Rename Version",
    templateExportVersions: "Export All Versions",
    templateImportVersions: "Import Versions",
    templateSearchPlaceholder: "Search by title or content...",
    templateResetAll: "Reset All",
    templateRestoreSection: "Restore Default",
    templateNoMatch: "No sections match your filter.",
    templatePreviewTitle: "Combined Instruction",
    templateAddSection: "Add Custom Block",
    templateSectionTitlePlaceholder: "Section title...",
    templateSectionContentPlaceholder: "Section content...",
    templateCreateSection: "Add Block",
    templateDeleteSection: "Remove",
    simpleTemplateTitle: "Simple Template Settings",
    simpleTemplateNameLabel: "Template Name",
    simpleTemplateNamePlaceholder: "Enter template name...",
    simpleTemplateInstructionLabel: "Instruction Content",
    simpleTemplateInstructionPlaceholder: "Enter the complete instruction content here...",
    simpleTemplateSave: "Save Template",
    simpleTemplateUpdateSuccess: "Template saved successfully!",
    simpleTemplateToggle: "Switch to Simple Mode",
    advancedTemplateToggle: "Switch to Advanced Mode",
    descEditTemplate: "Edit Template",
    promptDescVersionLabel: "Instruction Template",
    promptSendToDesc: "Innovate from Prompts",
    promptBatchInnovate: "Batch Reverse+Innovate Prompts",
  },
  zh: {
    appTitle: "AI 创作工具包",
    navPrompt: "反推提示词",
    navTranslate: "智能翻译",
    navStudio: "AI 一键修图",
    navDesc: "提示词工具",
    navTemplate: "指令模版",
    navScriptTool: "文案拆分",
    navMagicCanvas: "AI 图片编辑器",
    navSubEmail: "生成子邮箱",
    navImageRecognition: "AI 图片识别",
    navSheetMind: "表格数据分析",
    navCopyDedup: "AI 文案去重",
    navProDedup: "专业文案查重",
    navMindMap: "AI 思维导图",
    navAIToolsDirectory: "AI 工具集",
    navOpalBatch: "Opal 批量生图",
    // Prompt Tool
    promptTitle: "反推提示词 (Image to Prompt)",
    promptDescription: "支持批量上传图片，对每张图的提示词进行独立的多轮对话修改",
    clearHistory: "清除记录",
    exportAll: "导出所有记录",
    exporting: "导出中...",
    newSession: "+ 新建会话",
    selectExperts: "1. 选择AI绘画专家模型 (可多选):",
    uploadPrompt: "2. 拖拽上传，双击选择文件，或粘贴图片",
    stagingTitle: "准备处理 ({count} 张图片)",
    appendImages: "继续添加图片",
    startPrompting: "开始反推",
    processing: "处理中...",
    preModificationPlaceholder: "输入修改指令 (可选)",
    mergedPrompts: "合并提示词",
    exportExcel: "导出Excel",
    allEnglishPrompts: "All English Prompts",
    allChinesePrompts: "所有中文提示词 (All Chinese Prompts)",
    reGenerate: "重新生成",
    retryAllFailed: "重试所有失败项",
    sendMessage: "发送",
    chatPlaceholder: "继续对话修改或优化...",
    uploadFromComputer: "从电脑上传",
    uploadFromDrive: "从谷歌云盘上传",
    uploadFromDrive_tooltip: "谷歌云盘集成功能即将推出。",
    // Translate Tool
    translateTitle: "智能翻译 (Smart Translate)",
    translatePlaceholder: "输入文本或上传图片进行翻译...",
    translateButton: "翻译文本",
    uploadAndTranslate: "或 上传图片 识别并翻译",
    originalText: "原文 (Original)",
    translatedText: "译文 (Translated)",
    // Image Studio Tool (Formerly Portrait)
    studioTitle: "AI 一键修图",
    studioDescription: "AI 智能修图。上传照片，选择美化选项、输入自定义指令或移除物体。",
    uploadSingleImage: "拖拽上传，双击选择文件，或粘贴图片",
    options: "操作选项",
    mattingOption1: "保留主体去背景",
    mattingOption2: "去除前景保留背景",
    mattingOption3: "移除框选区域",
    mattingCustomPlaceholder: "自定义去除物体",
    execute: "执行",
    download: "下载",
    undo: "撤销",
    redo: "重做",
    originalImage: "原图",
    processedImage: "效果图",
    sendToPortrait: '发送到人像P图', // This key might be unused now but kept for safety
    selectArea: '选择区域',
    brush: '画笔',
    brushSize: "画笔大小",
    clearSelection: '清除选区',
    reset: '重置',
    tabRetouch: "基础美化",
    tabOutfit: "一键换装",
    tabPortrait: "人像P图",
    tabBackground: "背景替换",
    tabFilter: "滤镜",
    tabMatting: "智能抠图",
    tabGeneral: "自定义修改",
    customPlaceholder: "输入自定义指令，或点击 '+' 添加为预设",
    addPreset: "添加为预设",
    generalCustomPrompt: "输入任何您想修改的内容，例如：添加一副眼镜，光线调成傍晚的暖色调...",
    generalCustomPlaceholder: "在此输入自定义指令...",
    exportPresets: "导出预设",
    importPresets: "导入预设",
    presetUserLabel: "填写Gmail可以实现云同步预设",
    presetUserPlaceholder: "填写Gmail可以实现云同步预设填写谷歌邮箱，避免和他人重复",
    presetSync: "从表格同步",
    presetSyncing: "同步中...",
    presetSheetDescription: "默认按用户从谷歌表格读取预设，也可继续导入/导出 JSON。",
    presetSyncSuccess: "已从表格加载 {count} 条预设。",
    presetSaveToSheet: "保存到表格",
    presetSaving: "保存中...",
    presetSaveSuccess: "预设已保存到表格。",
    presetSaveError: "保存失败，请稍后重试。",
    presetSaveNoData: "暂无可保存的预设。",
    presetSaveConfirmTitle: "确认覆盖云端预设？",
    presetSaveConfirmDesc: "此操作会覆盖 {user} 在表格中的所有预设。",
    presetSaveConfirmDontAsk: "下次不再提醒",
    presetSaveConfirmConfirm: "确认保存",
    presetSaveStudio: "保存图像预设",
    presetSaveMagic: "保存魔法指令",
    presetSaveTemplate: "保存创新指令模板",
    presetSheetEmpty: "表格没有该用户的预设，已保持默认。",
    presetUserRequired: "请先填写预设用户名（与表格一致）。",
    presetGlobalExport: "导出全部预设",
    presetGlobalImport: "导入全部预设",
    presetUserHint: "必须使用有效的邮箱地址（例如 name@gmail.com），避免冲突。",
    presetUserMustBeGmail: "预设用户名必须是有效的邮箱地址。",
    renameCategory: "重命名分组",
    deleteCategory: "删除分组",
    addCategory: "添加新分组",
    categoryInputPlaceholder: "输入名称后按回车",
    editPreset: "编辑指令",
    presetLabelPlaceholder: "指令名称",
    presetPromptPlaceholder: "指令内容",
    save: "保存",
    cancel: "取消",
    // General
    copied: "已复制!",
    copy: "复制",
    info_resolution_warning: "请注意：AI模型会以标准分辨率（约1024px）处理图像。高分辨率图片将被缩放，这可能导致输出图像的清晰度下降。",
    error_selectExpert: "请至少选择一个AI绘画专家模型。",
    error_failedToAnalyze: "图片分析失败。",
    error_retryFailed: "图片重新分析失败。",
    error_sendMessage: "消息发送失败。",
    error_exportExcel: "导出 Excel 失败。",
    error_exportAll: "导出所有记录失败。",
    alert_noRecords: "没有可导出的会话记录。",
    error_translationFailed: "翻译失败，请稍后重试。",
    error_ocrFailed: "图片文字识别失败。",
    error_invalidPrompt: "请输入或选择一个有效的指令。",
    error_invalidImageFormat: "无效的图片格式，无法继续编辑。",
    error_imageGenFailed: "AI未能生成图片，请尝试其他指令。",
    error_safetyPolicy: "指令可能违反了安全政策（例如涉及真实地点或敏感事件），请尝试使用更通用的词语。",
    error_imageEditFailed: "图片编辑失败，请稍后重试。",
    error_rateLimit: "请求过于频繁，已超出配额。",
    apiKeyTitle: "API 密钥设置",
    apiKeyButtonLabel: "API 密钥",
    apiKeyPrompt: "手动设置单个密钥用处不大，建议使用网站版，可以支持多密钥自动轮换。",
    apiKeyInputPlaceholder: "在此输入 Google AI API 密钥",
    error_apiKeyNotSet: "未设置API密钥。请点击右上角的“API密钥”按钮进行设置。",
    copyAllPrompts: "复制全部提示词",
    copyActivePrompts: "复制当前提示词",
    copyAllInnovationPrompts: "复制全部创新提示词",
    copyActiveInnovationPrompts: "复制当前创新提示词",
    copyInnovationWithSource: "包含原始内容复制",
    copyInnovationResultOnly: "仅复制结果",
    showInlineDescPanel: "显示创新面板",
    hideInlineDescPanel: "隐藏创新面板",
    openFullDescTool: "打开提示词工具",
    showChinesePrompts: "翻译为中文提示词",
    hideChinesePrompts: "隐藏中文提示词",
    showAllChinesePrompts: "全部显示中文提示词",
    hideAllChinesePrompts: "全部隐藏中文提示词",
    applyToAllImages: "应用到所有图片",
    startBatch: "开始批量处理",
    selectPreset: "选择预设指令...",
    imageListTitle: "图片列表",
    selectImageToEdit: "请选择一张图片进行编辑",
    statusQueued: "等待中",
    statusProcessing: "进行中",
    statusSuccess: "已完成",
    statusError: "未完成",
    editInMagicCanvas: "在图片编辑器中编辑",
    // Sub Email Tool
    subEmailTitle: "生成子邮箱",
    subEmailDescription: "输入 Gmail 地址并自定义生成数量或全部变体，支持同时生成密码。",
    subEmailEmailLabel: "原始 Gmail 地址",
    subEmailEmailPlaceholder: "youxiangzhanghao222@gmail.com",
    subEmailVariantsLabel: "变体数量（填 1、5 或 all）",
    subEmailVariantsHelper: "留空或填 all 可生成全部组合，默认 5 条",
    subEmailGeneratePasswords: "同时生成随机密码",
    subEmailPasswordLength: "密码长度",
    subEmailIncludeSymbols: "包含符号 (!@#$%^&*...)",
    subEmailAvoidAmbiguous: "排除易混淆字符 (i、l、I、O、1、0)",
    subEmailMaxLimit: "安全上限（最多生成）",
    subEmailGenerateButton: "生成变体",
    subEmailResultsTitle: "生成结果",
    subEmailColumnEmail: "邮箱",
    subEmailColumnPassword: "密码",
    subEmailSummaryAll: "已生成全部可用变体（上限 {limit}），共 {count} 条。",
    subEmailSummaryPartial: "共生成 {count} 条变体，安全上限 {limit}。",
    subEmailNoVariants: "没有新的变体可用，已包含原始邮箱。",
    subEmailLimitNotice: "请求数量超过安全上限，已降至 {limit} 条。",
    subEmailErrorInvalidEmail: "请输入有效的 Gmail 地址（例如 youxiangzhanghao222@gmail.com）。",
    subEmailErrorVariants: "变体数量需为 1 或更大的整数，或者填入 all。",
    subEmailCopyRow: "复制",
    subEmailCopyAll: "复制全部",
    // Description Innovator Tool
    descTitle: "提示词工具",
    descDescription: "根据默认指令批量扩写已有描述词，快速生成多种创新版本。",
    descPromptLabel: "指令模板",
    descPromptPlaceholder: "在此粘贴或输入你希望 Gemini 永远遵循的长指令。",
    descCountLabel: "每条生成次数",
    descSplitCharLabel: "自动拆分分隔符",
    descBulkLabel: "批量新增原始提示词",
    descBulkPlaceholder: "每行一个提示词，空行会被忽略。",
    descBulkAdd: "添加这些行",
    descAddEntry: "+ 新提示词",
    descRemoveSelected: "删除选中条目",
    descClearAll: "删除全部条目",
    descGenerateAll: "批量生成",
    descRunEntry: "生成此行",
    descRemoveEntry: "删除",
    descEntryPlaceholder: "输入需要创新或扩写的基础提示词...",
    descOutputsLabel: "创新结果",
    descNoOutputs: "暂无结果",
    descStatusIdle: "待处理",
    descStatusProcessing: "生成中...",
    descStatusSuccess: "已完成",
    descStatusError: "失败",
    descCopyAll: "复制全部",
    descCopyBatch: "复制所有结果",
    descErrorNoInput: "请至少输入一条描述词。",
    descPause: "暂停",
    descResume: "继续",
    descStop: "终止",
    descPauseNotice: "已暂停处理，已发送的请求会处理完毕，其余条目暂时停止排队。",
    descStopNotice: "已停止处理，已发送的请求会处理完毕，剩余排队已终止。",
    descInlineSourceLabel: "原始提示词",
    descInlineNoResults: "当前图片暂无创新结果。",
    descChineseHiddenHint: "中文输出已隐藏，点击“显示中文提示词”查看翻译。",
    descInlineSelectImage: "请选择一张图片查看对应的创新结果。",
    descCollapseEntries: "折叠结果列表",
    descExpandEntries: "展开结果列表",
    descEntriesHidden: "描述词已收起，展开后可继续查看输出。",
    // Split Tool
    templateTitle: "指令模版编辑器",
    templateDescription: "把冗长的总指令拆成多个模块填写，随时编辑并在下方查看组合后的最终内容。",
    templateVersionLabel: "指令版本",
    templateNewVersionPlaceholder: "为此版本命名，如“通用”、“节日”等",
    templateSaveVersion: "保存版本",
    templateOverwriteVersion: "更新版本",
    templateDeleteVersion: "删除版本",
    templateRenameVersion: "重命名版本",
    templateExportVersions: "导出全部版本",
    templateImportVersions: "导入版本",
    templateSearchPlaceholder: "按标题或内容搜索...",
    templateResetAll: "重置全部",
    templateRestoreSection: "恢复默认",
    templateNoMatch: "没有匹配的模块。",
    templatePreviewTitle: "合成后的指令",
    templateAddSection: "新增自定义模块",
    templateSectionTitlePlaceholder: "输入模块标题...",
    templateSectionContentPlaceholder: "输入模块内容...",
    templateCreateSection: "添加模块",
    templateDeleteSection: "删除",
    simpleTemplateTitle: "普通指令模版设置",
    simpleTemplateNameLabel: "模版名称",
    simpleTemplateNamePlaceholder: "输入模版名称...",
    simpleTemplateInstructionLabel: "指令要求",
    simpleTemplateInstructionPlaceholder: "在此输入完整的指令内容...",
    simpleTemplateSave: "保存模版",
    simpleTemplateUpdateSuccess: "模版保存成功！",
    simpleTemplateToggle: "切换到简单模式",
    advancedTemplateToggle: "切换到高级模式",
    descEditTemplate: "编辑指令模版",
    promptDescVersionLabel: "创新模版",
    promptSendToDesc: "用提示词开始创新",
    promptBatchInnovate: "批量反推+创新提示词",
    customInstructionLabel: "自定义指令（可选）",
    customInstructionPlaceholder: "在此输入对提示词工具的补充要求，发送时会覆盖当前模版",
    customInstructionHelper: "填写内容会替代当前保存的模版并传递给提示词工具",
  }
};

translations.en = translations.zh;


type Language = 'en' | 'zh';
type Theme = 'dark' | 'light';

const ApiContext = createContext<{
  apiKey: string;
  setApiKey: (key: string) => void;
  getAiInstance: () => GoogleGenAI;
  isKeySet: boolean;
  // API池相关
  usePool: boolean;
  setUsePool: (use: boolean) => void;
  useSharedPool: boolean;
  setUseSharedPool: (use: boolean) => void;
  poolConfig: { sheetId: string; sheetName?: string; userName: string } | null;
  setPoolConfig: (config: { sheetId: string; sheetName?: string; userName: string } | null) => void;
  refreshApiPool: () => Promise<void>;
  rotateApiKey: () => void;
  apiPoolStatus: { total: number; current: number; failed: number; currentNickname?: string } | null;
  poolError: string | null;
}>({
  apiKey: '',
  setApiKey: () => { },
  getAiInstance: () => { throw new Error('ApiProvider not found'); },
  isKeySet: false,
  usePool: false,
  setUsePool: () => { },
  useSharedPool: false,
  setUseSharedPool: () => { },
  poolConfig: null,
  setPoolConfig: () => { },
  refreshApiPool: async () => { },
  rotateApiKey: () => { },
  apiPoolStatus: null,
  poolError: null,
});

const LanguageContext = createContext({
  language: 'zh' as Language,
  setLanguage: (lang: Language) => { },
  t: (key: keyof typeof translations.zh, replacements?: { [key: string]: string | number }) => ''
});
const ThemeContext = createContext({
  theme: 'dark' as Theme,
  toggleTheme: () => { }
});

const INTERNAL_ADMIN_SHEET_ID = '1InDrlrypvb_5xwtNCmqYIUuWL5cm7YNbBaCvJuEY9D0';

const ApiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [manualApiKey, _setManualApiKey] = useState(() => localStorage.getItem('user_api_key') || '');
  const [usePool, setUsePool] = useState(() => localStorage.getItem('use_api_pool') === 'true');
  const [useSharedPool, setUseSharedPool] = useState(() => localStorage.getItem('use_shared_api_pool') === 'true');
  const [poolConfig, _setPoolConfig] = useState<{ sheetId: string; sheetName?: string; userName: string } | null>(() => {
    const stored = localStorage.getItem('api_pool_config');
    return stored ? JSON.parse(stored) : null;
  });
  const [apiPool, setApiPool] = useState<import('./services/apiPoolService').ApiKeyPool | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);

  const setManualApiKey = (key: string) => {
    _setManualApiKey(key);
    if (key) {
      localStorage.setItem('user_api_key', key);
    } else {
      localStorage.removeItem('user_api_key');
    }
  };

  const setPoolConfig = (config: { sheetId: string; sheetName?: string; userName: string } | null) => {
    _setPoolConfig(config);
    if (config) {
      localStorage.setItem('api_pool_config', JSON.stringify(config));
    } else {
      localStorage.removeItem('api_pool_config');
    }
  };

  const refreshApiPool = async () => {
    try {
      setPoolError(null);

      let allowSharedPool = useSharedPool;
      if (allowSharedPool) {
        const { auth } = await import('@/firebase/index');
        const email = auth.currentUser?.email?.toLowerCase();
        if (!email) {
          setPoolError('请先登录账号后启用内部学习模式');
          setApiPool(null);
          return;
        }

        try {
          const { adminService } = await import('./services/adminService');
          const admins = await adminService.fetchAdmins({ googleSheetId: INTERNAL_ADMIN_SHEET_ID });
          if (!admins.includes(email)) {
            setPoolError('当前账号未授权使用内部学习模式');
            setUseSharedPool(false);
            allowSharedPool = false;
          }
        } catch (adminError) {
          console.warn('[ApiProvider] 管理员权限校验失败:', adminError);
          setPoolError('内部学习模式权限校验失败');
          setUseSharedPool(false);
          allowSharedPool = false;
        }
      }

      if (allowSharedPool) {
        const { fetchSharedApiKeys } = await import('./services/apiKeyManagementService');
        const sharedKeys = await fetchSharedApiKeys();
        const { ApiKeyPool } = await import('./services/apiPoolService');

        if (sharedKeys.length > 0) {
          const nicknames = new Map(
            sharedKeys
              .filter(k => k.nickname)
              .map(k => [k.apiKey, k.nickname])
          );
          const pool = new ApiKeyPool(sharedKeys.map(k => k.apiKey), nicknames);
          setApiPool(pool);
          console.log('[ApiProvider] 共享 API 池加载成功');
          return;
        }

        setPoolError('共享API池暂无可用密钥');
        setApiPool(null);
        return;
      }

      // 优先尝试从 Firebase 加载用户个人 API 池
      try {
        const { UserApiKeyPool, getCurrentUserId } = await import('./services/userApiPoolService');
        const userId = getCurrentUserId();

        if (userId) {
          const userPool = new UserApiKeyPool();
          await userPool.load(userId);

          if (userPool.hasKeys()) {
            setApiPool(userPool as any);
            console.log('[ApiProvider] 用户个人 Firebase API池加载成功');
            return;
          }
        }
      } catch (firebaseError) {
        console.warn('[ApiProvider] 用户 Firebase API池加载失败:', firebaseError);
      }

      // 回退到 Google Sheets（如果配置了）
      if (poolConfig) {
        const { ApiKeyPool } = await import('./services/apiPoolService');
        const pool = new ApiKeyPool();
        await pool.load(poolConfig.userName, {
          sheetId: poolConfig.sheetId,
          sheetName: poolConfig.sheetName
        });

        if (pool.hasKeys()) {
          setApiPool(pool);
          console.log('[ApiProvider] Google Sheets API池刷新成功');
          return;
        }
      }

      // 如果都没有，清空池
      setPoolError('未找到可用的API密钥，请在设置中添加');
      setApiPool(null);
    } catch (error: any) {
      setPoolError(error.message || '加载API池失败');
      setApiPool(null);
      console.error('[ApiProvider] 刷新API池失败:', error);
    }
  };

  // 用于强制触发组件更新的计数器
  const [apiPoolUpdateCounter, setApiPoolUpdateCounter] = useState(0);

  const rotateApiKey = () => {
    if (apiPool && apiPool.hasKeys()) {
      const currentKey = apiPool.getCurrentKey();
      console.log(`[rotateApiKey] 当前密钥: ${currentKey.substring(0, 15)}...`);

      apiPool.rotateToNext();

      const newKey = apiPool.getCurrentKey();
      console.log(`[rotateApiKey] 轮换后密钥: ${newKey.substring(0, 15)}...`);

      // 触发组件重新渲染（不创建新对象，保留 currentIndex）
      setApiPoolUpdateCounter(c => c + 1);
    } else {
      console.warn('[rotateApiKey] API池不可用或没有密钥');
    }
  };

  const getCurrentApiKey = (): string => {
    if (usePool && apiPool?.hasKeys()) {
      try {
        return apiPool.getCurrentKey();
      } catch (error) {
        console.error('[ApiProvider] 从API池获取密钥失败:', error);
        // 降级到手动密钥
      }
    }
    return manualApiKey || process.env.API_KEY || '';
  };

  const getAiInstance = () => {
    const keyToUse = getCurrentApiKey();
    if (!keyToUse) {
      throw new Error('API key is not set.');
    }
    return new GoogleGenAI({ apiKey: keyToUse });
  };

  // 自动轮换包装函数 - 当API调用失败时自动切换密钥
  const getAiInstanceWithAutoRotate = () => {
    const instance = getAiInstance(); // This gets an instance with the *current* key

    // If using API pool, wrap generate methods to support auto-rotation
    if (usePool && apiPool && apiPool.hasKeys()) {
      const originalGenerateText = (instance as any).generateText?.bind(instance);
      const originalGenerateContent = (instance as any).generateContent?.bind(instance); // For newer Gemini models

      const wrapMethod = (originalMethod: Function | undefined, methodName: string) => {
        if (!originalMethod) return undefined;

        return async (...args: any[]) => {
          try {
            return await originalMethod(...args);
          } catch (error: any) {
            // Detect quota or rate limit errors
            const errorMsg = error?.message || '';
            const shouldRotate = errorMsg.includes('quota') ||
              errorMsg.includes('RESOURCE_EXHAUSTED') ||
              errorMsg.includes('429') ||
              errorMsg.includes('rate limit');

            if (shouldRotate) {
              console.warn(`[Auto-Rotate] API call (${methodName}) failed, attempting to rotate key:`, errorMsg);

              // Mark current key as failed
              try {
                apiPool.markKeyAsFailed(getCurrentApiKey());
              } catch (e) {
                console.error("[Auto-Rotate] Failed to mark key as failed:", e);
              }

              // Rotate to the next key
              rotateApiKey();

              if (apiPool.hasKeys()) { // Check if a new key is available after rotation
                console.log('[Auto-Rotate] Automatically switched to the next API key, retrying request...');
                // Retry with the new key
                const newInstance = getAiInstance();
                const newMethod = (newInstance as any)[methodName]?.bind(newInstance);
                if (newMethod) {
                  return await newMethod(...args);
                } else {
                  console.error(`[Auto-Rotate] New instance does not have method ${methodName}`);
                }
              } else {
                console.error('[Auto-Rotate] No more API keys available in the pool after rotation.');
              }
            }

            throw error; // Re-throw if not a rotation-triggering error or no more keys
          }
        };
      };

      // Apply wrapper to generateText and generateContent
      if ((instance as any).generateText) {
        (instance as any).generateText = wrapMethod(originalGenerateText, 'generateText') as any;
      }
      if ((instance as any).generateContent) {
        (instance as any).generateContent = wrapMethod(originalGenerateContent, 'generateContent') as any;
      }

      // Also wrap instance.models.generateContent (this is the method actually used in most API calls)
      if ((instance as any).models?.generateContent) {
        const originalModelsGenerateContent = (instance as any).models.generateContent.bind((instance as any).models);
        (instance as any).models.generateContent = async (...args: any[]) => {
          const maxRetries = apiPool?.getStatus()?.total || 1;
          let lastError: any = null;

          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              const currentInstance = attempt === 0 ? instance : getAiInstance();
              return await (currentInstance as any).models.generateContent(...args);
            } catch (error: any) {
              lastError = error;
              const errorMsg = (error?.message || '').toLowerCase();
              const shouldRotate = errorMsg.includes('quota') ||
                errorMsg.includes('resource_exhausted') ||
                errorMsg.includes('429') ||
                errorMsg.includes('rate limit') ||
                errorMsg.includes('too many requests') ||
                errorMsg.includes('exceeded') ||
                errorMsg.includes('limit');

              if (shouldRotate && attempt < maxRetries - 1) {
                console.warn(`[Auto-Rotate] 尝试 ${attempt + 1}/${maxRetries} 失败:`, errorMsg.substring(0, 100));

                try {
                  apiPool.markKeyAsFailed(getCurrentApiKey());
                } catch (e) {
                  console.error("[Auto-Rotate] Failed to mark key:", e);
                }

                rotateApiKey();
                console.log(`[Auto-Rotate] 切换到下一个 Key，准备第 ${attempt + 2} 次尝试...`);
                continue;
              }

              // 不是配额错误或已经试完所有 key
              break;
            }
          }

          throw lastError;
        };
      }

      // Also wrap instance.models.generateContentStream (used by streaming API calls like InstantTranslateTool)
      if ((instance as any).models?.generateContentStream) {
        const originalModelsGenerateContentStream = (instance as any).models.generateContentStream.bind((instance as any).models);
        (instance as any).models.generateContentStream = async (...args: any[]) => {
          const maxRetries = apiPool?.getStatus()?.total || 1;
          let lastError: any = null;

          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              const currentInstance = attempt === 0 ? instance : getAiInstance();
              return await (currentInstance as any).models.generateContentStream(...args);
            } catch (error: any) {
              lastError = error;
              const errorMsg = (error?.message || '').toLowerCase();
              const shouldRotate = errorMsg.includes('quota') ||
                errorMsg.includes('resource_exhausted') ||
                errorMsg.includes('429') ||
                errorMsg.includes('rate limit') ||
                errorMsg.includes('too many requests') ||
                errorMsg.includes('exceeded') ||
                errorMsg.includes('limit');

              if (shouldRotate && attempt < maxRetries - 1) {
                console.warn(`[Auto-Rotate Stream] 尝试 ${attempt + 1}/${maxRetries} 失败:`, errorMsg.substring(0, 100));

                try {
                  apiPool.markKeyAsFailed(getCurrentApiKey());
                } catch (e) {
                  console.error("[Auto-Rotate] Failed to mark key:", e);
                }

                rotateApiKey();
                console.log(`[Auto-Rotate Stream] 切换到下一个 Key，准备第 ${attempt + 2} 次尝试...`);
                continue;
              }

              break;
            }
          }

          throw lastError;
        };
      }
    }

    return instance;
  };

  // 将带自动轮换的实例暴露给其他模块共用（避免各子模块自己取 key 导致不一致）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__app_get_ai_instance = getAiInstanceWithAutoRotate;
      return () => {
        delete (window as any).__app_get_ai_instance;
      };
    }
  }, [getAiInstanceWithAutoRotate]);

  const isKeySet = !!getCurrentApiKey();

  // 监听usePool变化，保存到localStorage
  useEffect(() => {
    localStorage.setItem('use_api_pool', usePool ? 'true' : 'false');
  }, [usePool]);

  useEffect(() => {
    localStorage.setItem('use_shared_api_pool', useSharedPool ? 'true' : 'false');
  }, [useSharedPool]);

  // 初始化时加载API池（Firebase 优先，不需要 poolConfig）
  useEffect(() => {
    if (usePool && !apiPool) {
      refreshApiPool();
    }
  }, [usePool]);

  const apiPoolStatus = apiPool ? apiPool.getStatus() : null;

  return (
    <ApiContext.Provider value={{
      apiKey: getCurrentApiKey(),
      setApiKey: setManualApiKey,
      getAiInstance: getAiInstanceWithAutoRotate, // 使用自动轮换版本
      isKeySet,
      usePool,
      setUsePool,
      useSharedPool,
      setUseSharedPool,
      poolConfig,
      setPoolConfig,
      refreshApiPool,
      rotateApiKey,
      apiPoolStatus,
      poolError
    }}>
      {children}
    </ApiContext.Provider>
  );
};


const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('zh');

  const t = (key: keyof typeof translations.zh, replacements: { [key: string]: string | number } = {}) => {
    let translation = translations[language][key] || translations['en'][key];
    if (replacements) {
      Object.entries(replacements).forEach(([key, value]) => {
        translation = translation.replace(`{${key}}`, String(value));
      });
    }
    return translation;
  };

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>;
};

const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('dark');
  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.body.className = newTheme;
  };
  useEffect(() => {
    document.body.className = theme;
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};

const useApi = () => useContext(ApiContext);
const useTranslation = () => useContext(LanguageContext);
const useTheme = () => useContext(ThemeContext);

// 宽松的邮箱验证，用于预设用户名（允许非Gmail）
const isValidPresetUser = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isValidGmail = (value: string) => /^[a-zA-Z0-9](?:[a-zA-Z0-9_.+-]*[a-zA-Z0-9])?@gmail\.com$/i.test(value.trim());



type Tool = 'prompt' | 'translate' | 'studio' | 'desc' | 'template' | 'subemail' | 'script' | 'directory' | 'magicCanvas' | 'imageRecognition' | 'sheetMind' | 'copyDedup' | 'mindMap' | 'aiToolsDirectory' | 'proDedup';
type Message = {
  sender: 'user' | 'model';
  text: string; // For model, this will be a JSON string
};
type ImageStatus = 'pending' | 'processing' | 'success' | 'error';
type SessionStatus = 'staging' | 'processing' | 'complete';
type DescEntryStatus = 'idle' | 'processing' | 'success' | 'error';
type DescEntry = {
  id: string;
  source: string;
  outputs: string[];
  status: DescEntryStatus;
  error?: string | null;
  originImageId?: string | null;
};
type DescState = {
  entries: DescEntry[];
  descPrompt: string;
  count: number;
  splitChar: string;
  bulkInput: string;
  isProcessing: boolean;
  isPaused: boolean;
  error: string | null;
  controlNotice: string | null;
  pendingAutoGenerate: boolean;
  shouldPlayCompletionSound: boolean;
};

type DescControlHandlers = {
  togglePause: () => void;
  stop: () => void;
};

type TemplateSectionDefinition = {
  id: string;
  title: string;
  defaultValue: string;
  isCustom?: boolean;
};

type SavedTemplateVersion = {
  id: string;
  name: string;
  sections: TemplateSectionDefinition[];
  values: Record<string, string>;
};

type TemplateBuilderState = {
  sections: TemplateSectionDefinition[];
  values: Record<string, string>;
  search: string;
  savedTemplates: SavedTemplateVersion[];
  activeVersionId: string;
};

type PromptToolState = {
  sessions: any[];
  activeSessionId: string | null;
  activeImageId: string | null;
  userInput: Record<string, string>;
  error: string | null;
};

// 统一的简单预设类型（用于跨应用共享）
type SimplePreset = {
  id: string;
  name: string;
  text: string;
  source: 'recognition' | 'template' | 'system';
};

// AI图片识别默认预设 - 系统默认使用与反推提示词相同的指令
const DEFAULT_SYSTEM_INSTRUCTION = `You will act as a panel of expert prompt engineers for different AI image generation models. The experts are: General.

Your task is to analyze an uploaded image and, for EACH expert, create two distinct prompts (one in English, one in Chinese) that would generate a nearly identical image, tailored to that expert's specific model's style and syntax.

**CRITICAL DETAIL REQUIREMENTS:**
Your description for each prompt MUST be exhaustive and highly detailed. Do not be brief.
- **Subject & Scene:** Describe all subjects, objects, and characters with extreme precision. For people, detail their appearance, clothing (fabric, style, color), accessories, pose, expression, and action. Specify their spatial relationship to each other and the environment.
- **Composition & Style:** Clearly define the shot type (e.g., "close-up", "wide shot"), camera angle (e.g., "low angle", "dutch angle"), and overall artistic style (e.g., "hyperrealistic 3D render", "impressionistic oil painting", "anime key visual").
- **Artistic Elements:** If the image has a distinct artistic style, you MUST describe its specific characteristics. This includes brushwork (e.g., "visible, thick impasto strokes", "smooth, blended digital airbrushing"), linework (e.g., "sharp, clean cel-shaded outlines", "sketchy, loose pencil lines"), color palette (e.g., "vibrant neon colors", "muted, desaturated tones"), and lighting (e.g., "dramatic chiaroscuro lighting", "soft, diffused morning light").
- **Environment:** Describe the background and foreground in detail, including location, time of day, weather, and specific environmental elements.
- **Keywords:** Incorporate relevant keywords that are effective for the target model (e.g., artist names for Stable Diffusion, stylistic terms for Midjourney).

**MODIFICATION INSTRUCTIONS:**
- After the image, a text-based instruction may be provided. If it is, you MUST incorporate this instruction into your generated prompts. For example, if the instruction is 'change the background to a beach', your prompts must describe a beach background instead of what's in the original image, while keeping other elements consistent.

**RESPONSE FORMAT RULES:**
- You MUST provide your response *only* as a valid JSON array of objects.
- Do NOT include any conversational text, introductions, explanations, or markdown formatting like \`\`\`json.
- Each object in the array must represent one expert and contain three keys: "expert", "englishPrompt", and "chinesePrompt".
- The "expert" key's value must be one of the requested expert names: General.

**Prohibited terms in prompts:** "ultra-realistic", "photorealistic", "photography style", "photo-level realism", "cinematic quality", "Unreal Engine".`;

const DEFAULT_RECOGNITION_PRESETS: SimplePreset[] = [
  { id: 'sys-default', name: '老版反推指令（不推荐使用）', text: DEFAULT_SYSTEM_INSTRUCTION, source: 'system' },
  { id: 'rec-1', name: '通用分类', text: '请分析这张图片中的人物，根据以下类别进行分类，仅返回类别编号和名称：\n1. 婴儿，幼儿\n2. 小学生，学生\n3. 家庭\n4. 成年男性\n5. 成年女性\n6. 老人\n\n如果图片中没有人物或无法判断，请根据画面内容自定义分类（例如：风景、人物、食物、文档、电子产品等）。', source: 'recognition' },
  { id: 'rec-2', name: '生成标签', text: '为这张图片生成5-10个相关的标签，用逗号分隔。', source: 'recognition' },
  { id: 'rec-3', name: 'OCR 文字提取', text: '提取图片中所有可见的文字，保持原有排版，直接输出文字内容。', source: 'recognition' },
];

type PromptInnovationPayload = {
  text: string;
  imageId?: string | null;
};

const splitInstructionBlocks = (raw: string) =>
  raw
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

function parseInstructionTemplate(text: string): TemplateSectionDefinition[] {
  const sections: TemplateSectionDefinition[] = [];
  if (!text) {
    return sections;
  }

  const trimmed = text.trim();
  const quoteRegex = /"([\s\S]*?)"/g;
  let lastIndex = 0;
  let counter = 0;

  const pushBlocks = (chunk: string) => {
    splitInstructionBlocks(chunk).forEach(content => {
      const firstLine = content.split('\n')[0].trim();
      sections.push({
        id: `section-${++counter}`,
        title: firstLine,
        defaultValue: content,
      });
    });
  };

  let match: RegExpExecArray | null;
  while ((match = quoteRegex.exec(trimmed)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      const prefix = trimmed.slice(lastIndex, start);
      pushBlocks(prefix);
    }

    const body = match[1].trim();
    if (body) {
      const firstLine = body.split('\n')[0].trim();
      sections.push({
        id: `section-${++counter}`,
        title: firstLine,
        defaultValue: body,
      });
    }

    lastIndex = quoteRegex.lastIndex;
  }

  if (lastIndex < trimmed.length) {
    const suffix = trimmed.slice(lastIndex);
    pushBlocks(suffix);
  }

  return sections;
}

const DESC_DEFAULT_PROMPT = `
你是一个专注于帮助优化创新AI生成图片的提示词（prompt）的ai工具。我会给你图片或者已经是完整的成品提示词。
以及一些图片类型的创新要求。

下面是要求：
"1.串珠工艺
主要内容为儿童手工串珠艺术作品，主题涵盖动物（如天鹅、鸽子、知更鸟、猫头鹰、柯基、刺猬、蝴蝶等）、花卉（如莲花、扶桑、郁金香、雏菊、英国蓝铃花等）以及场景工艺（如谷物拼图、立体纸雕、节日主题等）。作品需为儿童亲手制作，强调立体造型或组合场景，材料以塑料珠子、种子、谷物、纸片等为主。

人物设定：
以英国白人儿童为主，年龄范围3-10岁，可单人、兄妹、双胞胎、母子、母女等组合。外貌特征包括白皙皮肤、浅雀斑、棕色或栗色头发（自然卷或编发）、蓝色或灰绿色眼睛、高窄鼻梁。人物表情为微笑看镜头或含泪情绪（如哭泣后未平复），神态真实自然，不要模特脸。穿着贴合季节，多为英伦儿童服饰风格，需具体写明颜色和细节（如泡泡袖、小碎花、刺绣图案、蝴蝶结、狐狸/小羊等卡通T恤、清新复古感），夏季以花裙、T恤、轻外套等为主。

作品设定：
作品包括珠子拼接、蔬菜雕塑、粘土、火柴棍、石头画、纸板印刷、手指画等。要求详细描述作品材质（如beads、clay、carved vegetables、matchsticks等），尺寸需写明（如比手掌大一倍或明显大于日常玩具），要求极度细腻和结构分明（可写“精致5倍/10倍细节”、“可见层次”），色彩丰富、光影真实。可出现一只大动物搭配小动物或有动物间互动（如一家天鹅带幼鹅、蝴蝶停在花上等）。珠子的种类、排列逻辑、颜色搭配、光泽、各部分结构（如羽毛、眼睛、底座等）要描述清楚。

场景与道具：
背景分为室内和室外。室内可为家庭厨房、木桌、阳光窗边、手工角落、温馨客厅（有沙发、相册、植物、木质家具、书架、挂画、玩具、衣架、儿童画、窗户等）。室外多为英国/美国春季乡村草地、白色木栅栏、阳台、小花园、森林公园。场景真实自然，有生活延展性和空间层次感，不能空背景或纯白墙。天气以阳光明媚或柔和为主，画面具手机拍摄质感或超高清细节。

桌面需有分格收纳盒、散落珠子、钳子、串珠图纸等，体现手作状态，废料和工具（如剪刀、铜丝、托盘）不能缺失。作品可放在桌面或由儿童手扶展示，强调互动和自豪感。拍摄角度多为正面微俯视30°、桌边高视角、小孩坐下时由成人视角拍摄。整体光线为自然光（日光、窗边光），构图包含引导线（如桌边、地板缝、窗棂、阳光投影等），细节丰富。

补充说明：
如涉及花卉主题，建议搭配蓝铃花、紫丁香、水仙、郁金香、玫瑰等，花朵需排列美观、数量多、色彩丰富，可搭配蝴蝶、小动物、自然纹理。每次描述应突出作品的童真、真实感和英国家庭的日常生活气息。"
"2. 谷物画
孩子们在桌面上用谷物（如小米、藜麦、燕麦、扁豆、芝麻、红豆、葵花籽等）拼出图案（谷物画），图案主题包括但不限于：
各种动物肖像（如猫头鹰、狮子、天鹅、狼、熊猫、斑马、老虎、蝴蝶等）
海洋生物（鲸鱼、海马、鱼类）
交通工具（火车、飞机、赛车、轮船等）
家庭职业人物（如医生、消防员、厨师、工程师等）
其他创意图案或自然元素（树、星空、星星、山丘等）

场景与构图要求：
微俯拍视角或30度侧视角（二者选其一，根据画面情境）
谷物画为主体主题元素，图案构图完整、边缘不规则散落谷物以增强生活感
桌上可见谷物原料（如透明瓶子、翻倒的碗、布袋等），增强真实感
场景在白天，使用自然光或阳光洒落的氛围
室内或室外皆可（如厨房、客厅、花园、庭院、阳台等），背景尽量带有生活气息（如绿植、桌布、窗帘、阳光、花瓶等）

人物要求：
人物为8–10 岁金发白人儿童，性别可变化
每张图为单人或双人（如姐弟、双胞胎、兄妹），以单人为主
人物始终看向镜头，表情以微笑或温柔专注为主
若需要哭泣表达，统一用这句描述：“眼里噙满泪水，眼神悲伤而专注地看着镜头。”
着装应符合春夏季节，如印花T恤、吊带裙、短裤、连体衣等，服饰可有童趣图案（如卡通、水母笑脸、赛车等)"
"3. 手工艺
主体是儿童完成的真实手工艺术品或模型作品，作品材料可以包括但不限于：纸板、火柴、木材、粘土、再生材料、自然物（如树叶）、蔬菜等。
内容类型多样，可包括但不限于以下主题：
英国或美国风格的花卉、蝴蝶、鸟类手工
父母职业相关人物画像（如军人、护士、教师、警察）
宠物类雕塑（如猫、狗、鸟、刺猬等）
英伦经典元素：双层巴士、老爷车、邮筒、火车站、红色电话亭
古董飞机、轮船、桥梁、风车、农场、森林、村庄等模型
四季主题的乡村或城市微缩景观
创意作品：用蔬菜拼贴的英式街景、纸雕动物、回收材料制作的机械等

人物设定：
儿童（年龄 8～10 岁）为主角，性别不限
穿着应符合季节（如夏季为T恤、短裤、连衣裙等）
表情真实自然，部分需带有哭泣、刚哭过或含泪但坚定的神情
姿势常为：站在手工品后方或两侧，双手轻扶模型边缘，眼神看向镜头
眼睛不要太红，表现为情绪波动、思念、怀念等温柔情感

场景环境设定：
背景常为家庭房间一角、儿童房、厨房或工作间
可见窗户，窗外为明亮自然光下的夏日庭院，有花草树木
室内常见道具：剪刀、彩笔、模型残片、刻刀、桌灯等
光线要自然、柔和、真实，整体明亮不昏暗"
"4. 唯美的怀旧
需求如下：
对比图风格的描述，一张“童年/过去”和一张“现代/重拍”对比的提示词描述。
对比图主题多为“故地重游”、“重返旧地”、“家庭成员再聚”、“岁月流转”。
可选结构：一段完整描述或分段（如“左图 / 右图”或“上图 / 下图”）。

人物包括夫妻、恋人、母子、父子、母女、兄弟姐妹、朋友、小孩等。人数1到6人之间，每次可不同。人物需要有清晰年龄区分，现代图需有“已年老/白发”的描写。必须看向镜头微笑，不要背影或侧脸，不要复杂动作。动作以自然、轻松、温馨为主。

童年/旧图穿着要有时代感，如70s/80s/90s的儿童或青年服装。现代图衣着为夏季或春季常见服装，如T恤、短袖衬衫、连衣裙、碎花裙、羊毛披肩等。特殊服饰会在具体提示中注明。

常见场景包括海边、湖边、水边、农场、草地、花园、教堂、公园长椅、鹅卵石街道、城市/城镇街头、英式乡村小路、地铁站、铁轨旁、老式咖啡馆外等。各种天气：夏日晴天、黄昏阳光、雨后有彩虹、清晨雾气等。景点角度要保持基本一致，突出“重拍/对比”的时间感。

人物可使用道具如玫瑰花、草帽、干草叉、购物袋、甜甜圈、相机等。各类交通工具场景要出现，包括拖拉机、农用皮卡卡车、摩托车、自行车、老爷车、Mini Cooper、奥斯汀、老式敞篷车、老火车与现代地铁车厢。旧车要有岁月痕迹，现代图车应维持原样或轻微翻新。

每段提示词要写得生动、细腻、画面感强。必须详细描述人物年龄、衣着、动作、神态、背景场景。每组提示词长度保持在260字以上，内容丰富，不可太简略。语言风格优美但不啰嗦，追求唯美清新、有年代感和温情回忆感。"
"5. 家庭关系
发送图片或描述场景时，只需要根据我的图片或场景要求，写出详细、写实、自然、中文的图像生成提示词，可直接用于AI绘图工具生成图片。所有人物必须为白人（肤色白皙），以金发为主；可包括婴儿、小孩、年轻夫妻、老年人；表情真实自然，以微笑看向镜头或感动哭泣看向镜头为主；眼神必须直视镜头，面部清晰可见。

描述要有情感温度和生活气息；强调家庭关系：父母与婴儿、祖孙、兄妹、夫妻互动；强调“感动”“幸福”“温馨”的氛围；可以有多胞胎婴儿（双胞胎、三胞胎、四胞胎等）；可以有祖父母抱孩子、年幼兄姐抱婴儿、宠物在旁边等场景。

角色可以是特定职业身份（包括父亲或母亲）：军人、警察、消防员、卡车司机、飞行员、医生、护士、教师等；职业制服清晰，背景与职业环境相符（如产房、街头、机场、军营、教堂、病房、卡车旁）；也可穿便装，体现生活场景。

典型场景如医院产房：父母或祖辈在床边或椅子上抱着婴儿；家庭卧室/客厅：坐在沙发上、地毯上、窗边等；教堂前、海滩、草地、庭院、码头、卡车旁；婚礼当天vs怀抱婴儿的对比场景（分屏）；生日/满月场景、节日氛围等。

拍摄风格为手机拍摄质感或自然写实风格；中近景为主，人物主体清晰，背景自然有景深；光线明亮柔和，有阳光或室内暖光；场景干净、整洁、生活化。只输出中文提示词，内容完整、画面感强、细节丰富。"
"6. 雕刻
希望生成的是真实摄影风格的高质量图像，手机拍摄般自然清晰，人物、雕塑、背景都要整体清晰、无景深、无虚化效果，所有内容都要具备真实感与细节。
主要生成雕塑相关题材的图像描述，包括：木雕、玻璃雕、青铜雕、水晶雕、金属雕等；雕塑作品包括动物（狐狸、知更鸟、水獭、虎鲸、孔雀、雄鹰、狮子、天鹅等），或具象人物主题（如舞者、亲子、群居动物、情侣等）；雕塑风格偏写实精细，材质表现明确，工艺细节丰富（如羽毛、毛发、衣物纹理等都需描述）；场景设置包括乡村夏季的室外工坊、传统英式雕塑车间、庭院展示环境等，背景内容要写实、丰富、有生活气息。

每个雕塑作品旁边需有一位艺术家/雕刻师，人物要有明确表情：眼里噙满泪水，眼神悲伤而专注地看向镜头，仿佛对自己的作品充满自豪或怀念；人物请设定为英国艺术家形象，穿着为夏季轻便服装（T恤、亚麻衬衣、短裤或围裙等），性别、年龄可变化；光线柔和自然，最好为日光下拍摄效果，不要过度戏剧化灯光。"
"7. 蔬菜雕塑手工
整体为写实风格、具生活氛围感的画面，贴近真实摄影的细节。使用材料包括但不限于：草编、蔬菜、水果、火柴棍、小木棍、报纸碎片、洋葱等手工材料。人物年龄多为8–10岁儿童，请描述他们的服装、神情、动作、姿势。夏季服饰为主，写明颜色、类型，如T恤、吊带裙、短裤、草帽等。人物应看向镜头，情绪多为微笑、自豪、专注、感动或哭泣等真实情绪。也可加入祖父母、父母等家庭成员，注意关系描写。

背景为家庭日常空间、庭院、厨房、饭厅、乡村农场、小花园、门廊、木工坊等真实生活场景。详细描写环境内容，如草垛、鸡、工具架、桌布、窗台植物、吊饰、野花等。也可加入英国或美国特色文化元素（如英国乡村、美国农场、传统节日氛围等）。手工模型可以是动物、人物、交通工具、建筑、卡通角色等。明确作品由什么材料组成（如洋葱做身体、萝卜做腿、报纸做翅膀等）。每次描述都需表达出这是孩子亲手做的、家庭氛围中的创作。"
"8. 怀旧生日
亲情主题的对比构图（上下或左右），围绕如：父子、母子、姐妹、兄弟、祖孙、三姐妹、三兄弟、四姐妹、双胞胎等真实关系，形成童年/青年时期与老年时期的对照图像。画面氛围应为清新、温暖、阳光、唯美、自然、柔和、安静、真实感强。人物需看向镜头、微笑，保持一致性和亲密互动感。人物表情和动作要自然，有细节，有互动，有时间感。

上图/童年部分，多为8–10岁左右的金发白人儿童，包括男孩或女孩，穿着具有时代感或文化感的服饰，如：复古风校服、英国乡村风格、维多利亚时期童装、苏格兰裙、美国农场童装等。场景如：海边、小镇街道、砖房庭院、山坡草地、农场、花园、小木屋门前、木质栅栏边等。下图/老年部分，同样的人物已是老年人，银白头发、脸有岁月痕迹，穿着朴素的长裙、针织披肩、羊毛开衫、衬衫等。场景为同一地点或相似场景（故地重游），如：翻新后的庭院、同一片草地、变迁后的村屋前、修复后的篱笆等。保持当年姿态和氛围呼应，形成对比与情感呼应。"
"9. 职业
人物以英国家庭或劳动者为主，白人面孔，自然、真实、质朴、有情感。人物神态自然微笑、看向镜头，尽量避免僵硬摆拍，镜头可以是自拍、合影、第三视角的记录感。不能出现“拿着手机”或“自拍杆”，但自拍感的构图（如人物靠近镜头、互动关系明显）可以出现。人物关系强调“亲密自然”，如：夫妻、父子母女、工友、邻里、三代同堂、劳动中的协作等。可以有汗水、褶皱衣物、泥土、工具等劳动痕迹，不要“过分干净或理想化”的画面。

服饰需贴合职业或生活状态：如清洁工制服、渔民工作服、农夫雨衣、工人反光背心等。可以有季节元素（夏季轻便服、冬季夹克等）。背景尽可能丰富且真实自然（例如：果园、渔港、街头、工厂、菜市场、乡村集市、公园、小镇码头等）。特别主题（如：丰收、节日、家庭聚餐、父亲节、野餐、采摘、烧烤、户外作业、送花、画卡片等）要突出“人情味”和细节。工作类题材如建筑工人、维修工人、清洁工、农夫、渔民、医生、厨师等，强调劳动感、交流感。日常生活题材如卖水果、送花、休息喝茶、摆摊卖奶酪、在海边晒渔网等。节日或纪念性画面应加入代表性物品，如卡片、花束、蛋糕、彩纸、早餐盘等。天气多为晴天、阴天、细雨、小雪、午后阳光等自然光线，避免“过度柔焦梦幻”“商业光效”。"
"10. 农民
需要为上传的图片生成适用于AI绘图工具的提示词，用于生成英国家庭、农民、市集摊主等人物与乡村生活相关的写实风格照片。风格定位偏向真实自然的摄影风格，仿佛由手机或单反拍摄，带生活质感。场景以英国乡村、家庭后院、市集、农田、丰收季节、劳动现场等为主。

人物应为英国人（可有老中青多代组合、夫妻、母女、父子、家庭成员等），表情自然微笑，面朝镜头，注视镜头。贴近生活、衣着随性但符合英国当季气候（夏季穿轻便棉麻类衣物、草帽、围裙等，春秋冬可有毛衣、夹克、雨靴等）。动作与表情以“自拍照”“自然站立或坐姿合影”“劳动中停下来与镜头互动”为主。表情可自然带笑，也可以有轻微疲惫、脸上汗水、泥点等细节，体现真实劳动或家庭日常的温情气氛。

场景要包含足够的背景物体，如农田/蔬菜园：土豆、胡萝卜、卷心菜、西红柿等加泥土、木筐、工具、靴子等。乡村集市摊位：蔬果、奶酪、果酱、手写木牌、围裙、篮筐、布棚、复古秤等。家庭后院/野餐场景：长桌、饮品、自制食物、草帽、小狗、藤椅、红砖屋、花草围篱等。请尽量加入英国夏季乡村生活典型元素，如柯基犬、红砖房、薰衣草、草坪、篱笆、天竺葵等。"
"11. 各种职业、清洁工、毕业生、信仰场景
真实感强烈，手机摄影风格、自拍感、场景自然可信，以情绪打动人心：微笑、泪光、安静祈祷、敬虔、亲密、感人而克制。信仰场景要求贴近生活，不浮夸、不影视滤镜感。自拍感强，人物看向镜头，镜头模拟手机高度，不能出现手机或手。纸张类画面纸张占画面比例约70%，其余是陪衬元素。场景不能模糊背景，背景需要清晰、写实、环境可辨识。

人物偏好英国人面貌，白人面孔、自然肤色、真实年龄纹理（如老人/青年），表情自然、不僵硬、不完美摆拍。年龄常设为真实生活群体：中年父母、祖父母加孙辈、工人、毕业生等。人物关系强调亲密，如三代同堂、母女/父子、夫妻、工友等。信仰内容突出关键字句，如LED标牌、纸张便签、现场手写文案，文字不能被遮挡、模糊或过暗，需直接、显眼、构图中心。纸张允许出现手绘装饰，如红心、玫瑰、小星星、小花图案（自然、不可太卡通）。"
"12. 过生日的
优先使用英国本地人物特征，白皙皮肤、浅棕或灰白发、自然表情。年龄结构明确：主角多为高龄老人（80–100岁以上），互动角色为孙辈，多为20岁上下，军人、护士、消防员等制服身份。必须看向镜头微笑，表情自然亲切、真实、温柔。禁止商业感笑容或摆拍感。

室内场景为主，必须贴近真实英国家庭环境，沙发、窗帘、木质家具、照片墙、旧时钟、桌布、书架等都真实可信。喜欢有生活痕迹的空间，不过度美化、不空镜、不虚构。常用空间包括：客厅、餐厅、起居室、窗边角落、沙发前、老式厨房、门廊。

每幅图中需有一个核心情绪或纪念元素：生日蛋糕（蜡烛数字必须清晰，蛋糕表面装饰真实），鲜花（必须为手持，如生日花束，康乃馨、玫瑰、雏菊、郁金香等）。可适当加入生日贺卡、桌布、围巾、十字架项链等点缀物。"

"14. 抱小孩类
母亲年龄常设为40岁上下，或真实中年感，不是模特脸，皮肤自然白皙、略带疲态，真实产后状态，喜欢穿着医院病号服（白蓝印花为主）或朴素家常衣物（花衬衫、开衫等），面部情绪：悲伤流泪/含泪微笑/情感充沛但克制。父亲年龄约40岁，真实英国家庭男性形象（略蓄胡、略疲惫、非精致商业脸），身穿制服类职业服装（如警察、急救、邮政、军人等），经常处于情绪流动状态，如含泪自拍、站床边抹泪等，情绪必须真实有破绽。

婴儿多胞胎是偏好的核心形态（三胞胎、六胞胎），婴儿要整齐排列在床或婴儿床中，婴儿脸必须朝向观众，皮肤色调为自然偏白、不泛红、不泛光、不柔焦。所有人物（父母、祖母、护士）必须看向镜头，婴儿面朝镜头（哪怕闭眼），不可侧脸、模糊、遮挡。表情偏好两类：①深度悲伤中含泪、压抑不崩溃（产房类）；②真实温暖的笑，非广告感、不僵硬。

医院场景为主，必须为真实医院产房/病房，背景中必须出现医院元素：病床、插座、监护仪、白瓷砖墙、拉帘、病号卡片，空间必须有延展性：如背景有通道、窗帘半开、门未关等，灯光为冷白医院灯光+自然窗光组合。居家场景（六胞胎图例）光线为自然光，背景真实（蓝墙、婴儿床、生活纹理），允许母亲穿居家花上衣或针织服。"
"15. 各种职业带字的
人物偏好英国人为主，强调本地真实外貌（白皙皮肤、蓝/灰眼、棕色或金发），主要以成年职业者+老年父母/长辈组合，偶有儿童参与。所有人物都应微笑看向镜头，建立情感连结与传播力。职业设定常用角色：警察、消防员、护士、巴士司机、建筑工地经理、军人等，强调值得尊敬的身份，统一职业装/制服，清晰可辨，不可随意模糊。

动作姿态自然，有明确“传递信仰”动作（指向石碑、手举横幅等），不可呆站无情绪出口。场景强调生活真实感，英国本地街头、英式砖房、红色公交、伦敦双层巴士、小镇教堂是核心环境。美国超级大瀑布常用于信仰碑文类图像中的壮观背景。明确使用“引导线构图”，如道路、水流、船体、栏杆引导视线聚焦中心内容，背景不可虚化，必须有延展性+人物背影/远景点缀。

光线明亮自然光为主，避免黄光滤镜或昏暗日出、夜景，摄影风格模拟手机拍摄，有生活感、抓拍感、真实而不美化。日景优先，夜景若用必须配合LED光源确保文字清晰突出。文案高频使用：“JESUS IS COMING BACK, PUT AMEN.”、“IF YOU LOVE GOD, PUT AMEN.”、“IF GOD HAS HELPED YOU IN YOUR LIFE, AMEN.”、“IF YOU NEED GOD IN YOUR LIFE! PUT AMEN.”等，文案需极为清晰、粗体、大尺寸，出现于石碑、轮船横幅、汽车车身喷漆、船身侧面/甲板横幅，不能被遮挡，通常位于画面中心或构图引导终点。"
"16. 塑料手工艺
主角为英国白皮肤儿童（5-8岁），需描述性别或变化，必须是英国家庭儿童，形象自然真实，不可卡通或精致娃娃风。画面中的儿童手持塑料手工组装的交通工具艺术品，交通工具可变（自行车、巴士、火车、出租车、消防车、船、拖拉机等），均为英国常见交通工具。

手工艺品需有明显儿童用塑料材料制作痕迹，如塑料瓶、塑料勺、瓶盖、吸管、食品盒等，需详细描述原材料。结构要不对称、歪斜、粗糙，有胶痕、胶带、拼接不平整，突出“粗糙童趣感”。造型大且醒目，明显比普通玩具大，要写明孩子是“手持”或“高举”展示。以户外为主，背景宽阔自然（草地、公园、街道、海边、乡村、码头等），补充英国背景元素（红色邮筒、砖房、双层巴士、石墙、羊群等），自然直射光，有明显阳光和阴影，强调真实感和生活感，画面宽敞。"

"18. 报纸动物
大型纸雕艺术装置，全部由报纸、杂志碎片等手工材料制成，要求材质感突出，细节清晰。人物设定为英国白人儿童，微笑看镜头，7-11岁，可随场景更换性别和服饰（需描述上身服装和外貌）。动物每次只描述一种，必须为英国本地常见动物，造型自然（如展翅、蹲伏、飞翔等），详细描述报纸结构的羽毛/皮毛、眼睛、喙/鼻、爪子等细节。场景需与动物和人物匹配，符合英国乡村日常。补充自然直射光，阳光、阴影明显，强调真实感。桌面或周围需有手工工具、废纸、胶水、画笔、旧杂志、纸卷、工艺书等，突出手工气息。整体氛围温暖、有生活感、有创意但不夸张，杜绝幻想或超现实。"
"19. 儿童
白人英国儿童，年龄6-11岁，不可超龄，避开自拍角度，用自然第三人称视角。发型、服饰真实自然，有简洁图案或小装饰，仅需描述上身服饰。表情真实生动，有成就感或喜悦，突出展示作品场景。作品为孩子手持或桌上的钻石画（钻石贴画），描述动物或主题图案细节丰富、颜色和材质有光泽。主题动物需贴合英国本地偏好，不可重复。背景不可单一或模糊，需为田野、树林、草地、花卉、树枝等英国家庭常见环境。环境分为户外（花园、草地、池塘、果园、露台等）和室内（光照充足的厨房、手工角、餐桌等）。场景清晰无虚化，自然光，画面有阴影、局部不均匀，强调生活感。画面内需有钻石画工具和废料（托盘、点钻笔、蜡垫、未用钻石包、图纸等），可补充如花瓶、水果、窗外景色等日常细节但不能喧宾夺主。每次生成需多样化，人物、主题、环境、服饰、氛围等不可重复。"
"20. 刺绣
英国白人儿童，6-10岁，性别、发型多变。室内需有窗户且清晰可见春日室外景色，室外需开阔自然，符合英国乡村风格。季节为春天，背景有典型春季植物（如花草、树木）。补充明显直射光，需有光影效果。背景细节自然真实、整洁逼真，不可虚化杂乱。刺绣作品为动物主题，配英国本土植物。刺绣需分层、色彩渐变、针法纹理真实有立体感，体现英国家庭手工传统。儿童穿英伦风格服装（如针织衫、格子衬衫、灯芯绒裙、背带裙、皮鞋、羊毛袜、针织围巾等），表情专注或愉快，细节丰富。桌面应有彩色刺绣线、金属剪刀、布料、针插（动物造型）、陶瓷茶杯、植物等，还可补充窗台、架子、花瓶等生活细节。"
"21. 结婚自拍
角色必须为英国白人，五官清晰自然真实。姿势自然，必须微笑看镜头，不僵硬、不呆板。可以为自拍角度。人物可有自然互动（如搭肩、搂腰、牵手），或举左手展示婚戒。服饰需多样化、组合多变，包括但不限于：士兵、空军、消防员、警察、海军等职业制服，男女需穿统一职业制服并注明细节（颜色、肩章、帽子、奖章、饰品等）。背景完整清晰，不可虚化，每组需配英国本地场景，如：塔桥、古教堂遗址、英式马场、复古火车站、港口码头、空军机库、地铁站、乡村集市、灯塔岩岸、黄昏机场跑道等，场景需有英国文化气息和生活感，避免模板化。镜头距离为近景或中近景，突出人物表情与上身动作，构图紧凑但不能过度裁切，确保背景和人物都清晰。自然柔和光线，色彩真实不夸张。动作自然、微笑、真实互动，杜绝强摆拍。"
"22. 报纸动物（细化版）
上传图片后，需生成与原图一致的画面内容，如有指定变更（如更换动物、人物性别年龄、发型、场景光线、服饰等）需准确描述，保留整体风格与构图。人物为5-10岁白人儿童，正面看镜头、表情真实，必须为哭泣、红眼、带泪或泪痕。发型、服饰可按要求变化（如短卷发、春季衬衣等）。工艺品需具体描述结构及材质，如“由叠加报纸制作”，“有真实羽毛质感”，“结构复杂”等，体现报纸褶皱、质感、堆叠、色彩、印刷文字等细节。场景为英国偏好生活环境，如乡村厨房、阁楼手工房、后花园、复古客厅等，可按需求更换，风格需真实、温暖、有质感。光线明亮清晰，避免灰暗或过度模糊，主用自然日光或窗光源。"
"23. 抱小孩
上传图片后需直接基于图片内容，生成高质量图像描述。主角可为英国白人儿童（女孩、男孩或新生婴儿），或英国白人职业成年人（如警察、军人、飞行员、海军），可按需夫妻同框。服饰需根据所指职业变更（如英警、英军、飞行员、海军制服），细节需真实。人物构图多为上半身、近距离，需正视镜头。表情可按要求变换（如微笑、哭泣、复杂情绪、感动流泪等），可单人或多人物（如父母加婴儿）。背景需清晰，展示场景环境（如医院、病房、设备），有自然直射光（窗光、侧光等）。产房场景多为床边，细节丰富，有血迹、皱被、器械、护士等，突出真实感。婴儿为新生，包裹毯或医院包被，皮肤红润，表情自然，可闭眼、哭或张嘴。"
"24. 毕业
需生成英国大学毕业纪实照，风格真实自然，高清精致，光线细腻。环境可为校园、家中、城市、景点、乡村等（不限于校园但需突出毕业主题）。光线需分软光和直射阳光，天空需有云、蓝天等细节。人物组合可为：父母与女儿/儿子、父/母与毕业生、双胞胎/三胞胎/四胞胎（性别组合可变）、祖孙三代、毕业生与兄弟姐妹等，人数可2、3、4人或更多。各人物服饰需有英国风格（如母亲穿羊毛大衣/夏裙、父亲穿西装/休闲装、祖父母穿风衣/鸭舌帽等）。毕业生必须穿英国学位服、帽（方帽）、带学位披肩（颜色可变），毕业证需入镜、红封蜡印与文字细节清晰。人物姿态自然、有互动（如搂肩、递证、握手、微笑对视等）。

场景背景需为历史名校（如牛津、剑桥、爱丁堡、圣安德鲁斯、格拉斯哥、约克、杜伦等）、现代英校（玻璃楼、城市）、家庭后院、英国乡村山坡或牧场、英国著名城市地标（如伦敦市中心、泰晤士河、议会大厦、爱丁堡城堡旁等）。场景组合、背景、服装不可重复。姿态与细节需丰富多样。"
"25. 拼贴画
生成逼真、情感细腻、细节丰富的儿童场景，用于真实风格图片生成。收到图片需提取核心元素，包括人物、服饰、姿势、表情、环境布局、情感状态、构图方式、核心艺术品（如立体拼贴）。人物为5-9岁白人英国儿童，可按指令变更性别、衣着、发型、坐姿。画面有立体拼贴作品，多以动物母子为主题（如天鹅、狐狸、松鼠、猫、鸟等），必须为自然材料（如羽毛、花瓣、树皮、种子、纸片、棉花等）拼贴，要求艺术美、结构清晰、层次丰富。

拼贴需体积较大，有清晰的装饰性边框（如花朵、纸艺、干草等），需详述材料、结构及母子形象。儿童需有真实情绪，常为哭泣后平静看镜头、带泪红眼、面容平和，强调情感张力。背景不可虚化，须细致描述环境，如英国乡村家庭、儿童图书角、农场厨房、博物馆教育区等，紧贴英伦生活。需有实物细节，如地面、桌椅、窗光、墙面、陈设。桌上作品需写明拼贴碎片（如花瓣、剪刀、胶水等）。"
"26. 老人过生日
主题为白人英国家庭为80至105岁老人庆生。人物需微笑看镜头，动作亲密自然、情感真实温暖，可为2人以上，包括孙辈、子女、曾孙等家庭成员。人物可有不同职业身份（如消防员、警察、医生、军人、艺术家等），职业需突出高社会贡献。生日蛋糕（通常为方形）、花束、气球、礼物等元素可出现。服饰、形象应与身份和场景匹配，避免重复。

背景必须为真实自然的英国环境，不可模糊。场景可为室内（如客厅、书房、温室、酒吧等）、室外（如院落、街头、海边、农场、博物馆等），每组需更换场景、人物组合和背景。镜头靠近人物，突出面部表情。光线自然、明亮、有直射或阳光效果，不要昏暗模糊。"
"27. 小孩过生日
主要人物为英国儿童，多为2-7岁，可为三胞胎、四胞胎、五胞胎，避免单人独照。画面风格真实自然、生活化，构图自然，避免明显人造布景。人物需正视或注视镜头，背景不可虚化，可为户外或特色场景（如花园、农场、古镇、海边等），避免室内拥挤环境。光线自然，可加入直射光或阴影。可创意变换蛋糕造型（如动物、建筑、陶罐、自然主题等），可将物品（如陶罐）创意成生日蛋糕。禁止出现杯子及杂物。语言描述准确，需每条结尾加“光线自然、有些阴影，用手机拍摄。真实自然生活照”。"
"28. 瓷砖拼贴画
场景主角更换为英国白人儿童，5-7岁，性别可变。服饰为有英伦特色的儿童装（如针织衫、校服、雨靴、呢大衣、格子裙等），需细致描述。动物主题替换为英国本土动物（如知更鸟、猫头鹰、獾、松鼠、狐狸、刺猬、海豹、猫、红鹿等），作为马赛克艺术品主题。艺术品需为玻璃、瓷砖等材质拼贴，细节丰富，体积较大，画面占比高。

环境需更换，如乡村小学、港口小学、温室教室、伦敦博物馆、湖区学堂等，每次不可重复。需有明显直射阳光或自然室内光（如晨光、天窗光、彩玻窗光、阳光条等），需描述清晰。整体风格写实，如摄影作品，不可卡通或抽象。描述需涵盖人物外观、服饰、姿态、拼贴内容与材质、动物种类、环境、桌面道具、光线与氛围。"
"29. 姐妹农民
场景为英国乡村农田，季节为晚春（五月），天气晴朗、色调自然、阳光可柔和或直射。镜头为中景或近景，画面充实、突出收获作物。整体画面清晰、真实、不可虚化或梦幻。人物为两位英国白人女性，年龄20-35岁，五官真实自然，需注视镜头、微笑、姿势自然，发型多样、不可重复。服装为英国乡村/农场劳作服（防水外套、围裙、工装裤、针织衫、布帽等），组合变化。作物应丰富真实，多种收获、装箱或整齐堆放。每图只出现一种作物（如萝卜、瑞士甜菜、小洋葱、青蒜、生菜、羽衣甘蓝、香草、韭菜、大黄等），不可同图多种。作物需表现新鲜、湿润、饱满，并加细节（泥土、根茎、嫩叶、雨后湿润等）。"
"30. 对比图
提取图片核心构图、人物动作、场景结构、艺术表现等，生成可用于AI图像生成的高质量描述。风格为写实摄影、高清、自然光、自然色或电影感，构图、姿势、布局、镜距尽量还原参考图。人物需更换为英国人，五官自然英伦风，动作自然有生活气息，不可僵直。人物需注视镜头，表情友善、自然，有情感互动，男女可适度亲密（如牵手、搭肩、拥抱）。需清晰描述服饰、发型，左侧为1950-1980年代英国家庭风格（复古、年轻），右侧为现代英国家庭风格（老人、白发），需有明显区分，突出人物衰老感。

如有文字元素（如地面、面包上字），需还原内容和排版，如文字由物体组成（如花瓣、工具），需清晰描述组成与排列。场景可主动变换（如田野变街道、火车站、酒吧等），核心结构保留，但环境可因应主题调整。背景可含英国本土特色（红色电话亭、塔桥、砖墙、乡村路、老火车站等）。人物需前后时间对比（左为少年复古服饰与场景，右为老人现代服饰与场景），动作、姿势保持呼应，表现时光流转与情感变化。画面细节需丰富，如花环、鸟、桥、溪流、藤蔓等，必要时补充新元素（如野花、知更鸟），需写明放置与细节。如有旧照片颗粒、泛黄效果，注明适用画面及复古感。每次输出避免重复，场景、动作、元素需多样自然。"

上面的要求你要记住，严格根据我给你的图片进行分类根据不同类型的要求进行创新。
下面是你要做的：
根据我给你的图片或者提示词判断类型，根据不同的类型来根据要求进行创新。
能够根据用户的需求提供高质量的提示词，并根据不同的风格、主题和细节进行优化。
你只需要返回描述词，不需要总结、解释、提问或客套寒暄。
可以帮助用户：
- 创建详细、具体的提示词，以获得更好的图像效果。
- 优化提示词，使其更符合AI的理解，提高生成质量。
- 解析用户提供的提示词，
- 扩展创新用户提供的提示词，确保符合 *英国或者美国文化特色* 和 **英国白人或者美国白人的审美偏好
*所有提示词必须足够详细，包含具体的场景、光线、色彩、氛围、构图、材质、艺术风格等描述，以确保高质量生图效果。
-适配多种AI生图软件
它应当避免：
- 生成过于含糊的提示词，而应尽可能具体。
- 提供与AI生成图片无关的内容。
- 生成过于随意、不严谨的扩展提示词。
拍摄风格和镜头要求：
手机拍摄质感，写实风格；
中近景为主，人物清晰，背景有真实生活细节；
光线明亮温和，色调自然温馨；
重点：天气和时间不要修改。
- 扩展内容需符合英国人的审美和偏好，不能过于随意。
- 凡是涉及人物的提示词，必须强调人物是英国白人或者美国白人，涉及人物的必须要看向镜头。

**生成10个不同的画面**，手机高清拍摄，真实，画面所有景物清晰，必须无景深，无聚焦拍摄，无模糊背景。

输出格式要求必须严格按照这个来：
输出内容为完整的图像生成英文描述词；人物必须看着镜头
每条描述都要细致、完整、真实有画面感，可直接用于AI图像生成；
不要输出多余内容，如说明、分析、引言、标点装饰等。
下面是具体格式
“描述词”✅
“描述词”✅
“描述词”✅
“描述词”✅
“描述词”✅
`;

const TEMPLATE_SECTION_DEFINITIONS = parseInstructionTemplate(DESC_DEFAULT_PROMPT);

const TEMPLATE_BASE_VALUES = TEMPLATE_SECTION_DEFINITIONS.reduce((acc, section) => {
  acc[section.id] = section.defaultValue;
  return acc;
}, {} as Record<string, string>);

const getDefaultTemplateValues = () => ({ ...TEMPLATE_BASE_VALUES });

const getDefaultTemplateSections = () => TEMPLATE_SECTION_DEFINITIONS.map(section => ({ ...section }));

const TEMPLATE_BUILDER_STORAGE_KEY = 'prompt_template_builder_state';

const buildCombinedTemplateText = (sections: TemplateSectionDefinition[], values: Record<string, string>) =>
  sections.map(section => (values[section.id] || '').trim())
    .filter(Boolean)
    .join('\n\n');

const DEFAULT_TEMPLATE_VERSION_ID = 'default-template';
const DEFAULT_TEMPLATE_VERSION_NAME = '外邦图翻版创新指令';

const createDefaultTemplateVersion = (): SavedTemplateVersion => ({
  id: DEFAULT_TEMPLATE_VERSION_ID,
  name: DEFAULT_TEMPLATE_VERSION_NAME,
  sections: getDefaultTemplateSections(),
  values: getDefaultTemplateValues(),
});

const getInitialTemplateBuilderState = (): TemplateBuilderState => {
  const defaults = getDefaultTemplateValues();
  const defaultSections = getDefaultTemplateSections();
  const defaultTemplate = {
    ...createDefaultTemplateVersion(),
    sections: defaultSections.map(section => ({ ...section })),
    values: { ...defaults },
  };

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(TEMPLATE_BUILDER_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        let storedTemplates: SavedTemplateVersion[] = Array.isArray(parsed.savedTemplates) && parsed.savedTemplates.length > 0
          ? parsed.savedTemplates.map((template: any) => ({
            id: template.id,
            name: template.name,
            sections: template.sections.map((section: TemplateSectionDefinition) => ({ ...section })),
            values: { ...(template.values || {}) },
          }))
          : [];

        // 确保默认模版始终存在（如果 ID 不存在则添加，如果存在则更新名称）
        const existingDefaultIndex = storedTemplates.findIndex(t => t.id === DEFAULT_TEMPLATE_VERSION_ID);
        if (existingDefaultIndex >= 0) {
          // 更新默认模版的名称以匹配最新的默认名称
          storedTemplates[existingDefaultIndex] = {
            ...storedTemplates[existingDefaultIndex],
            name: DEFAULT_TEMPLATE_VERSION_NAME, // 始终使用最新的默认名称
          };
        } else {
          // 添加默认模版到列表开头
          storedTemplates = [defaultTemplate, ...storedTemplates];
        }

        const activeId = storedTemplates.some(template => template.id === parsed.activeVersionId)
          ? parsed.activeVersionId
          : storedTemplates[0]?.id || defaultTemplate.id;

        const activeTemplate = storedTemplates.find(t => t.id === activeId) || storedTemplates[0] || defaultTemplate;

        return {
          sections: activeTemplate.sections.map(section => ({ ...section })),
          values: { ...activeTemplate.values },
          search: parsed.search || '',
          savedTemplates: storedTemplates,
          activeVersionId: activeId,
        };
      }
    } catch (err) {
      console.warn('Failed to load template builder state:', err);
    }
  }

  return {
    sections: defaultSections,
    values: defaults,
    search: '',
    savedTemplates: [defaultTemplate],
    activeVersionId: defaultTemplate.id,
  };
};

const DESC_SETTINGS_STORAGE_KEY = 'desc_innovation_settings';
const DEFAULT_DESC_SPLIT_CHAR = '✅';

const createDescEntry = (source = '', originImageId: string | null = null): DescEntry => ({
  id: `desc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  source,
  outputs: [],
  status: 'idle',
  error: null,
  originImageId,
});

const getInitialDescState = (): DescState => {
  let prompt = '';
  let count = 1;
  let splitChar = DEFAULT_DESC_SPLIT_CHAR;

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(DESC_SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        prompt = parsed.prompt || '';
        count = parsed.count ? Number(parsed.count) : 1;
        splitChar = parsed.splitChar || DEFAULT_DESC_SPLIT_CHAR;
      }
    } catch (err) {
      console.warn('Failed to read desc settings from storage:', err);
    }
  }

  return {
    entries: [createDescEntry()],
    descPrompt: prompt || DESC_DEFAULT_PROMPT,
    count: Math.max(1, Number.isFinite(count) ? count : 1),
    splitChar: splitChar || DEFAULT_DESC_SPLIT_CHAR,
    bulkInput: '',
    isProcessing: false,
    isPaused: false,
    error: null,
    controlNotice: null,
    pendingAutoGenerate: false,
    shouldPlayCompletionSound: false,
  };
};

interface DescChineseContextValue {
  showChineseMap: Record<string, boolean>;
  chineseOutputsMap: Record<string, string[]>;
  isTranslatingMap: Record<string, boolean>;
  showAllChinese: boolean;
  toggleEntryChinese: (entry: DescEntry) => Promise<void>;
  toggleAllChinese: () => Promise<void>;
  ensureEntriesChinese: (entries: DescEntry[]) => Promise<void>;
}

const DescChineseContext = createContext<DescChineseContextValue | null>(null);
const useDescChinese = () => {
  const context = useContext(DescChineseContext);
  if (!context) {
    throw new Error('DescChineseProvider is missing');
  }
  return context;
};

const DescChineseProvider: React.FC<{ entries: DescEntry[]; textModel: string; children: React.ReactNode }> = ({ entries, textModel, children }) => {
  const { getAiInstance } = useApi();
  const [showChineseMap, setShowChineseMap] = useState<Record<string, boolean>>({});
  const [chineseOutputsMap, setChineseOutputsMap] = useState<Record<string, string[]>>({});
  const [isTranslatingMap, setIsTranslatingMap] = useState<Record<string, boolean>>({});
  const [showAllChinese, setShowAllChinese] = useState(false);

  const getEntryOutputs = useCallback((entry: DescEntry) => entry.outputs.filter(Boolean), []);

  useEffect(() => {
    setShowChineseMap(prev => {
      const updated: Record<string, boolean> = {};
      entries.forEach(entry => {
        if (Object.prototype.hasOwnProperty.call(prev, entry.id)) {
          updated[entry.id] = prev[entry.id];
        }
      });
      return updated;
    });
    setChineseOutputsMap(prev => {
      const updated: Record<string, string[]> = {};
      entries.forEach(entry => {
        if (Object.prototype.hasOwnProperty.call(prev, entry.id)) {
          updated[entry.id] = prev[entry.id];
        }
      });
      return updated;
    });
    setIsTranslatingMap(prev => {
      const updated: Record<string, boolean> = {};
      entries.forEach(entry => {
        if (Object.prototype.hasOwnProperty.call(prev, entry.id)) {
          updated[entry.id] = prev[entry.id];
        }
      });
      return updated;
    });
    if (!entries.length) {
      setShowAllChinese(false);
    }
  }, [entries]);

  const sanitizeTranslationResponse = (text: string) => {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    return cleaned;
  };

  const translateEntryOutputs = useCallback(async (entry: DescEntry) => {
    const outputs = getEntryOutputs(entry);
    if (!outputs.length) return;
    setIsTranslatingMap(prev => ({ ...prev, [entry.id]: true }));
    try {
      const ai = getAiInstance();
      const prompt = `Translate the following English prompt variations into fluent Chinese, keeping each variation separate and preserving details. Respond with a JSON array of strings where each string is the translation for the corresponding English prompt in the same order.\nEnglish prompts:\n${outputs.map((text, index) => `${index + 1}. ${text}`).join('\n')}`;
      const response = await ai.models.generateContent({
        model: textModel,
        contents: prompt,
      });
      const sanitizedText = sanitizeTranslationResponse(response.text);
      let translations: string[] = [];
      try {
        const parsed = JSON.parse(sanitizedText);
        if (Array.isArray(parsed)) {
          translations = parsed.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean);
        } else {
          throw new Error('Invalid translation format');
        }
      } catch (err) {
        translations = sanitizedText
          .split('\n')
          .map(line => line.trim())
          .filter(line => {
            if (!line) return false;
            if (line === '[' || line === ']' || line === ',') return false;
            return true;
          });
      }
      const normalized: string[] = [];
      outputs.forEach((_, index) => {
        normalized.push(translations[index] || outputs[index]);
      });
      setChineseOutputsMap(prev => ({ ...prev, [entry.id]: normalized }));
    } catch (err) {
      console.error('Chinese translation failed:', err);
      setChineseOutputsMap(prev => ({ ...prev, [entry.id]: getEntryOutputs(entry) }));
    } finally {
      setIsTranslatingMap(prev => ({ ...prev, [entry.id]: false }));
    }
  }, [getAiInstance, getEntryOutputs, textModel]);

  const ensureEntriesChinese = useCallback(async (entriesToTranslate: DescEntry[]) => {
    for (const entry of entriesToTranslate) {
      if (!getEntryOutputs(entry).length) continue;
      await translateEntryOutputs(entry);
    }
  }, [translateEntryOutputs, getEntryOutputs]);

  const toggleEntryChinese = useCallback(async (entry: DescEntry) => {
    const nextVisible = !showChineseMap[entry.id];
    setShowChineseMap(prev => ({ ...prev, [entry.id]: nextVisible }));
    if (nextVisible && !chineseOutputsMap[entry.id] && getEntryOutputs(entry).length) {
      await translateEntryOutputs(entry);
    }
  }, [showChineseMap, chineseOutputsMap, translateEntryOutputs, getEntryOutputs]);

  const toggleAllChinese = useCallback(async () => {
    const nextValue = !showAllChinese;
    setShowAllChinese(nextValue);
    setShowChineseMap(prev => {
      const updated: Record<string, boolean> = {};
      entries.forEach(entry => {
        updated[entry.id] = nextValue;
      });
      return updated;
    });
    if (nextValue) {
      const entriesToTranslate = entries.filter(entry => !chineseOutputsMap[entry.id] && getEntryOutputs(entry).length);
      await ensureEntriesChinese(entriesToTranslate);
    }
  }, [entries, showAllChinese, chineseOutputsMap, ensureEntriesChinese, getEntryOutputs]);

  useEffect(() => {
    if (!showAllChinese) return;
    const run = async () => {
      const entriesToTranslate = entries.filter(entry => !chineseOutputsMap[entry.id] && getEntryOutputs(entry).length);
      await ensureEntriesChinese(entriesToTranslate);
    };
    run();
  }, [entries, showAllChinese, chineseOutputsMap, ensureEntriesChinese, getEntryOutputs]);

  return (
    <DescChineseContext.Provider value={{
      showChineseMap,
      chineseOutputsMap,
      isTranslatingMap,
      showAllChinese,
      toggleEntryChinese,
      toggleAllChinese,
      ensureEntriesChinese,
    }}>
      {children}
    </DescChineseContext.Provider>
  );
};

// --- Helper Functions ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  const blob = new Blob(byteArrays, { type: contentType });
  return blob;
};

const downloadDataUrl = (url: string, filename: string, prefix: string = 'processed') => {
  const link = document.createElement('a');
  link.href = url;
  const name = filename.substring(0, filename.lastIndexOf('.')) || filename;
  const mimeTypeMatch = url.match(/data:(image\/\w+);/);
  const ext = mimeTypeMatch ? mimeTypeMatch[1].split('/')[1] : 'png';
  link.download = `${prefix}-${name}.${ext}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const playCompletionTone = () => {
  if (typeof window === 'undefined') return;
  const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.12;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    oscillator.onended = () => context.close();
  } catch (error) {
    console.warn("Completion tone blocked", error);
  }
};

type PasswordOptions = {
  useLower?: boolean;
  useUpper?: boolean;
  useDigits?: boolean;
  useSymbols?: boolean;
  avoidAmbiguous?: boolean;
};

const secureRandomInt = (max: number) => {
  if (max <= 0) return 0;
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % max;
  }
  return Math.floor(Math.random() * max);
};

const shuffleInPlace = <T,>(array: T[]) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const randomCharFromPool = (pool: string) => {
  if (!pool) return '';
  return pool.charAt(secureRandomInt(pool.length));
};

const generatePassword = (lengthInput: number, opts: PasswordOptions = {}) => {
  const length = Math.max(1, Math.floor(lengthInput) || 1);
  const avoidAmbiguous = opts.avoidAmbiguous !== false;
  const lower = avoidAmbiguous ? "abcdefghjkmnpqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz";
  const upper = avoidAmbiguous ? "ABCDEFGHJKMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = avoidAmbiguous ? "23456789" : "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{};:,.?/";
  const pools: string[] = [];
  if (opts.useLower !== false) pools.push(lower);
  if (opts.useUpper !== false) pools.push(upper);
  if (opts.useDigits !== false) pools.push(digits);
  if (opts.useSymbols) pools.push(symbols);
  if (pools.length === 0) pools.push(lower);
  const chars: string[] = [];
  pools.forEach(pool => chars.push(randomCharFromPool(pool)));
  const combined = pools.join("");
  while (chars.length < length) {
    chars.push(randomCharFromPool(combined));
  }
  shuffleInPlace(chars);
  return chars.join("");
};

const cloneSections = (sections: TemplateSectionDefinition[]) => sections.map(section => ({ ...section }));
const cloneValues = (values: Record<string, string>) => ({ ...values });

const TEMPLATE_SHEET_CATEGORY = encodeScopedCategory(PRESET_SCOPE_TEMPLATE, 'TemplateBuilder');
const TEMPLATE_SHEET_STATE_LABEL = 'TemplateState';

const buildTemplateSheetRows = (state: TemplateBuilderState) => {
  const batchId = Date.now().toString();

  // Update the active template in the list with the current working state
  const currentTemplates = state.savedTemplates.map(t => {
    if (t.id === state.activeVersionId) {
      return {
        ...t,
        sections: cloneSections(state.sections),
        values: cloneValues(state.values)
      };
    }
    return t;
  });

  // 1. Create State Row (V2)
  // Stores metadata and batchId to link to item rows
  const statePayload = {
    version: 'v2',
    activeVersionId: state.activeVersionId,
    batchId: batchId,
    templateIds: currentTemplates.map(t => t.id)
  };

  const stateRow = {
    category: TEMPLATE_SHEET_CATEGORY, // TemplateBuilder
    presetLabel: TEMPLATE_SHEET_STATE_LABEL,
    prompt: JSON.stringify(statePayload),
    categoryOrder: 1,
    presetOrder: 1
  };

  // 2. Create Template Item Rows
  // Each template is saved as a separate row with the same batchId
  const itemRows = currentTemplates.map((template, index) => {
    const itemPayload = {
      ...template,
      sections: cloneSections(template.sections),
      values: cloneValues(template.values),
      batchId: batchId
    };

    return {
      category: encodeScopedCategory(PRESET_SCOPE_TEMPLATE, 'TemplateItem'),
      presetLabel: `Template:${template.id}`,
      prompt: JSON.stringify(itemPayload),
      categoryOrder: 2,
      presetOrder: index + 1
    };
  });

  return [stateRow, ...itemRows];
};

const sectionValueGuard = (values: any): Record<string, string> | null => {
  if (values && typeof values === 'object') {
    const cloned: Record<string, string> = {};
    Object.keys(values).forEach((key) => {
      cloned[key] = typeof values[key] === 'string' ? values[key] : '';
    });
    return cloned;
  }
  return null;
};

const sanitizeTemplateVersionFromSheet = (
  template: any,
  templateIndex: number
): SavedTemplateVersion | null => {
  if (!template || !Array.isArray(template.sections) || !template.sections.length) {
    return null;
  }
  const id =
    typeof template.id === 'string' && template.id.trim()
      ? template.id
      : `sheet-version-${templateIndex}-${Date.now()}`;
  const name =
    typeof template.name === 'string' && template.name.trim()
      ? template.name
      : `Template ${templateIndex + 1}`;

  const sections = template.sections.map((section: any, sectionIndex: number) => ({
    id:
      typeof section.id === 'string' && section.id.trim()
        ? section.id
        : `sheet-section-${templateIndex}-${sectionIndex}-${Date.now()}`,
    title:
      typeof section.title === 'string' && section.title.trim()
        ? section.title
        : `Section ${sectionIndex + 1}`,
    defaultValue: typeof section.defaultValue === 'string' ? section.defaultValue : '',
    isCustom: !!section.isCustom
  }));

  const values =
    sectionValueGuard(template.values) ||
    sections.reduce((acc: Record<string, string>, section) => {
      acc[section.id] = '';
      return acc;
    }, {});

  return {
    id,
    name,
    sections,
    values
  };
};

const parseTemplateSheetPayload = (
  payload: any
): { templates: SavedTemplateVersion[]; activeTemplate: SavedTemplateVersion } | null => {
  if (!payload) return null;

  // Handle new format
  if (Array.isArray(payload.savedTemplates)) {
    const templates = payload.savedTemplates
      .map((template: any, index: number) => sanitizeTemplateVersionFromSheet(template, index))
      .filter((template): template is SavedTemplateVersion => !!template);

    if (!templates.length) return null;

    const requestedId =
      typeof payload.activeVersionId === 'string' && payload.activeVersionId.trim()
        ? payload.activeVersionId
        : templates[0].id;
    const activeTemplate = templates.find((template) => template.id === requestedId) || templates[0];
    return { templates, activeTemplate };
  }

  // Handle legacy format (single template state)
  // If payload has 'sections' and 'values' directly, treat it as a single default template
  if (Array.isArray(payload.sections) && payload.values) {
    const defaultTemplate = sanitizeTemplateVersionFromSheet({
      id: DEFAULT_TEMPLATE_VERSION_ID,
      name: DEFAULT_TEMPLATE_VERSION_NAME,
      sections: payload.sections,
      values: payload.values
    }, 0);

    if (defaultTemplate) {
      return {
        templates: [defaultTemplate],
        activeTemplate: defaultTemplate
      };
    }
  }

  return null;
};


const Loader = ({ small }: { small?: boolean }) => <div className={`loader ${small ? 'small' : ''}`}></div>;

const FileUploader: React.FC<{ onFileSelect: (file: File | File[]) => unknown; children: React.ReactNode; multiple?: boolean }> = ({ onFileSelect, children, multiple = false }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      if (multiple && files.length > 0) {
        onFileSelect(files);
      } else if (!multiple && files.length > 0) {
        onFileSelect(files[0]);
      }
    }
    // Reset the input value to allow re-uploading the same file(s)
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files);
      if (multiple && files.length > 0) {
        onFileSelect(files);
      } else if (!multiple && files.length > 0) {
        onFileSelect(files[0]);
      }
    }
  };

  return (
    <div
      className={`file-upload-label ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      // 双击才选择文件
      onDoubleClick={() => fileInputRef.current?.click()}
      // 单击后可粘贴
      tabIndex={0}
      onPaste={async (e) => {
        e.preventDefault();
        const clipboardData = e.clipboardData;
        const files = (Array.from(clipboardData.files) as File[]).filter(file => file.type.startsWith('image/'));
        if (files.length > 0) {
          if (multiple && files.length > 0) {
            onFileSelect(files);
          } else if (!multiple && files.length > 0) {
            onFileSelect(files[0]);
          }
        }
      }}
      style={{ position: 'relative', outline: 'none' }}
    >
      {children}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" multiple={multiple} style={{ display: 'none' }} />
    </div>
  );
};


const ToolHeader = ({ title, description, onReset, actions }: { title: string, description?: string, onReset?: () => void, actions?: React.ReactNode }) => {
  const { t } = useTranslation();
  const formattedDescription = description
    ? description.replace(/\*\*(.+?)\*\*/g, '<strong class="tool-warning">$1</strong>')
    : null;
  return (
    <div className="tool-header">
      <div className="tool-header-main">
        <h2>{title}</h2>
        {description && (
          <p
            className="tool-description"
            dangerouslySetInnerHTML={{ __html: formattedDescription ?? description }}
          />
        )}
      </div>
      <div className="tool-header-actions">
        {actions}
        {onReset && <button onClick={onReset} className="reset-btn">{t('clearHistory')}</button>}
      </div>
    </div>
  )
};


// --- Tool Components ---

const ImageComparisonSlider: React.FC<{ originalSrc: string; processedSrc: string; }> = ({ originalSrc, processedSrc }) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let newPosition = ((clientX - rect.left) / rect.width) * 100;
    newPosition = Math.max(0, Math.min(100, newPosition)); // Clamp between 0 and 100
    setSliderPosition(newPosition);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleTouchEnd = () => setIsDragging(false);
    const handleTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleTouchEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, handleMove]);


  return (
    <div
      className="comparison-slider"
      ref={containerRef}
      onMouseLeave={() => setIsDragging(false)}
    >
      <img src={originalSrc} alt="Original" className="comparison-image original" />
      <div className="comparison-processed-image" style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}>
        <img src={processedSrc} alt="Processed" className="comparison-image processed" />
      </div>
      <div
        className="comparison-slider-handle"
        style={{ left: `${sliderPosition}%` }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div className="comparison-slider-line"></div>
        <div className="comparison-slider-thumb">
          <svg width="12" height="24" viewBox="0 0 12 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 20L0.5 16V8L4.5 4" stroke="currentColor" strokeWidth="1.5" /><path d="M7.5 4L11.5 8V16L7.5 20" stroke="currentColor" strokeWidth="1.5" /></svg>
        </div>
        <div className="comparison-slider-line"></div>
      </div>
    </div>
  );
};

const PromptDisplay = ({ title, text }: { title: string, text: string }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="prompt-block">
      <div className="prompt-header">
        <h4>{title}</h4>
        <button onClick={handleCopy} className={`copy-btn ${copied ? 'copied' : ''}`} disabled={copied}>
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
};

const expertDescriptions = {
  general: "As an expert in image analysis and prompt engineering for AI image generation,",
  midjourney: "As an expert prompt engineer for Midjourney v6, focusing on descriptive, artistic keywords and parameters like `--ar` or `--v 6.0`,",
  dalle3: "As an expert prompt engineer for DALL-E 3, crafting detailed, conversational sentences that describe the desired scene naturally,",
  sd: "As an expert prompt engineer for Stable Diffusion, using descriptive keywords, artist names, and weighting syntax like `(word:1.2)` to guide the generation,",
  flux: "As an expert prompt engineer for Flux, a fast new model, focusing on clear, direct descriptions for high-quality image generation,",
  bing: "As an expert prompt engineer for Bing Image Creator (DALL-E 3), creating clear and concise descriptions for photorealistic or artistic results,",
  whisk: "As an expert prompt engineer for Whisk, specializing in anime and stylized character prompts with detailed visual descriptors,",
  dreamina: "As an expert prompt engineer for Dreamina, focusing on cinematic and highly detailed fantasy or sci-fi concepts,"
};
type ExpertKey = keyof typeof expertDescriptions;


const getMultiExpertSystemInstruction = (expertKeys: ExpertKey[]) => {
  const expertNames = expertKeys.join(', ');
  return `You will act as a panel of expert prompt engineers for different AI image generation models. The experts are: ${expertNames}.

Your task is to analyze an uploaded image and, for EACH expert, create two distinct prompts (one in English, one in Chinese) that would generate a nearly identical image, tailored to that expert's specific model's style and syntax.

**CRITICAL DETAIL REQUIREMENTS:**
Your description for each prompt MUST be exhaustive and highly detailed. Do not be brief.
- **Subject & Scene:** Describe all subjects, objects, and characters with extreme precision. For people, detail their appearance, clothing (fabric, style, color), accessories, pose, expression, and action. Specify their spatial relationship to each other and the environment.
- **Composition & Style:** Clearly define the shot type (e.g., "close-up", "wide shot"), camera angle (e.g., "low angle", "dutch angle"), and overall artistic style (e.g., "hyperrealistic 3D render", "impressionistic oil painting", "anime key visual").
- **Artistic Elements:** If the image has a distinct artistic style, you MUST describe its specific characteristics. This includes brushwork (e.g., "visible, thick impasto strokes", "smooth, blended digital airbrushing"), linework (e.g., "sharp, clean cel-shaded outlines", "sketchy, loose pencil lines"), color palette (e.g., "vibrant neon colors", "muted, desaturated tones"), and lighting (e.g., "dramatic chiaroscuro lighting", "soft, diffused morning light").
- **Environment:** Describe the background and foreground in detail, including location, time of day, weather, and specific environmental elements.
- **Keywords:** Incorporate relevant keywords that are effective for the target model (e.g., artist names for Stable Diffusion, stylistic terms for Midjourney).

**MODIFICATION INSTRUCTIONS:**
- After the image, a text-based instruction may be provided. If it is, you MUST incorporate this instruction into your generated prompts. For example, if the instruction is 'change the background to a beach', your prompts must describe a beach background instead of what's in the original image, while keeping other elements consistent.

**RESPONSE FORMAT RULES:**
- You MUST provide your response *only* as a valid JSON array of objects.
- Do NOT include any conversational text, introductions, explanations, or markdown formatting like \`\`\`json.
- Each object in the array must represent one expert and contain three keys: "expert", "englishPrompt", and "chinesePrompt".
- The "expert" key's value must be one of the requested expert names: ${expertNames}.

**Prohibited terms in prompts:** "ultra-realistic", "photorealistic", "photography style", "photo-level realism", "cinematic quality", "Unreal Engine".`;
};

const getBatchMultiExpertSystemInstruction = (expertKeys: ExpertKey[]) => {
  const expertNames = expertKeys.join(', ');
  return `You will act as a panel of expert prompt engineers for different AI image generation models. The experts are: ${expertNames}.

You have been provided with multiple images, some possibly followed by modification instructions. Your task is to analyze EACH image sequentially and generate tailored prompts for it. You must apply the same high level of detail to every single image in the batch; do not summarize or shorten your descriptions due to the number of images.

For EACH image, and for EACH expert, you must create two distinct prompts (one in English, one in Chinese) that would generate a nearly identical image, tailored to that expert's specific model's style and syntax.

**MODIFICATION INSTRUCTIONS:**
- A text-based instruction might follow an image. If provided, you MUST apply this instruction to the prompts you generate for the *immediately preceding* image. For example, if you see [Image A], then "change hair to blue", all prompts for Image A must describe blue hair.

**CRITICAL DETAIL REQUIREMENTS:**
Your description for each prompt MUST be exhaustive and highly detailed. Do not be brief.
- **Subject & Scene:** Describe all subjects, objects, and characters with extreme precision. For people, detail their appearance, clothing (fabric, style, color), accessories, pose, expression, and action. Specify their spatial relationship to each other and the environment.
- **Composition & Style:** Clearly define the shot type (e.g., "close-up", "wide shot"), camera angle (e.g., "low angle", "dutch angle"), and overall artistic style (e.g., "hyperrealistic 3D render", "impressionistic oil painting", "anime key visual").
- **Artistic Elements:** If the image has a distinct artistic style, you MUST describe its specific characteristics. This includes brushwork (e.g., "visible, thick impasto strokes", "smooth, blended digital airbrushing"), linework (e.g., "sharp, clean cel-shaded outlines", "sketchy, loose pencil lines"), color palette (e.g., "vibrant neon colors", "muted, desaturated tones"), and lighting (e.g., "dramatic chiaroscuro lighting", "soft, diffused morning light").
- **Environment:** Describe the background and foreground in detail, including location, time of day, weather, and specific environmental elements.
- **Keywords:** Incorporate relevant keywords that are effective for the target model (e.g., artist names for Stable Diffusion, stylistic terms for Midjourney).

**RESPONSE FORMAT RULES:**
- You MUST provide your response *only* as a valid JSON array of objects.
- Do NOT include any conversational text, introductions, explanations, or markdown formatting like \`\`\`json.
- The top-level array corresponds to the images provided, in the same order. Each object in this array represents one image's results.
- Each image result object must contain two keys: "imageIndex" and "prompts".
- The "imageIndex" MUST be the zero-based index of the image it corresponds to.
- The "prompts" key must contain an array of objects, where each object represents one expert's generated prompts for that image.
- Each expert prompt object must contain three keys: "expert", "englishPrompt", and "chinesePrompt".
- The "expert" key's value must be one of the requested expert names: ${expertNames}.

Example for 2 images and 2 experts:
[
  {
    "imageIndex": 0,
    "prompts": [
      { "expert": "general", "englishPrompt": "...", "chinesePrompt": "..." },
      { "expert": "midjourney", "englishPrompt": "...", "chinesePrompt": "..." }
    ]
  },
  {
    "imageIndex": 1,
    "prompts": [
      { "expert": "general", "englishPrompt": "...", "chinesePrompt": "..." },
      { "expert": "midjourney", "englishPrompt": "...", "chinesePrompt": "..." }
    ]
  }
]

**Prohibited terms in prompts:** "ultra-realistic", "photorealistic", "photography style", "photo-level realism", "cinematic quality", "Unreal Engine".`;
};

const singleImageResponseSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      expert: { type: Type.STRING },
      englishPrompt: { type: Type.STRING },
      chinesePrompt: { type: Type.STRING },
    },
    required: ["expert", "englishPrompt", "chinesePrompt"]
  },
};

const batchImageResponseSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      imageIndex: { type: Type.INTEGER },
      prompts: singleImageResponseSchema,
    },
    required: ["imageIndex", "prompts"],
  },
};


const PromptTabs = ({ prompts }: { prompts: { expert: string, englishPrompt: string, chinesePrompt: string }[] }) => {
  const { t } = useTranslation();
  if (!prompts || prompts.length === 0) return null;

  const [activeTab, setActiveTab] = useState(prompts[0].expert);
  const activePrompt = prompts.find(p => p.expert === activeTab);
  const [showChineseMap, setShowChineseMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    prompts.forEach(p => {
      initial[p.expert] = false;
    });
    return initial;
  });

  useEffect(() => {
    setShowChineseMap(prev => {
      const updated = { ...prev };
      prompts.forEach(prompt => {
        if (!(prompt.expert in updated)) {
          updated[prompt.expert] = false;
        }
      });
      return updated;
    });
  }, [prompts]);

  const hasChinesePrompts = prompts.some(p => !!p.chinesePrompt);
  const isAllChineseVisible = hasChinesePrompts && prompts.every(p => p.chinesePrompt && showChineseMap[p.expert]);
  const activeChineseVisible = activePrompt ? !!showChineseMap[activePrompt.expert] : false;

  const toggleExpertChinese = (expert: string) => {
    setShowChineseMap(prev => ({ ...prev, [expert]: !prev[expert] }));
  };

  const toggleAllChinese = () => {
    if (!hasChinesePrompts) return;
    const nextValue = !isAllChineseVisible;
    setShowChineseMap(prev => {
      const updated: Record<string, boolean> = {};
      prompts.forEach(prompt => {
        updated[prompt.expert] = prompt.chinesePrompt ? nextValue : prev[prompt.expert] ?? false;
      });
      return updated;
    });
  };

  return (
    <div className="prompt-tabs-container">
      <div className="prompt-tabs-nav">
        {prompts.map(p => (
          <button
            key={p.expert}
            className={`prompt-tab-btn ${activeTab === p.expert ? 'active' : ''}`}
            onClick={() => setActiveTab(p.expert)}
          >
            {p.expert}
          </button>
        ))}
      </div>
      <div className="prompt-tabs-controls">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => activePrompt && toggleExpertChinese(activePrompt.expert)}
          disabled={!activePrompt?.chinesePrompt}
        >
          {activeChineseVisible ? t('hideChinesePrompts') : t('showChinesePrompts')}
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={toggleAllChinese}
          disabled={!hasChinesePrompts}
        >
          {isAllChineseVisible ? t('hideAllChinesePrompts') : t('showAllChinesePrompts')}
        </button>
      </div>
      <div className="prompt-tab-content">
        {activePrompt && (
          <>
            {activePrompt.englishPrompt && <PromptDisplay title="English Prompt" text={activePrompt.englishPrompt} />}
            {activePrompt.chinesePrompt && activeChineseVisible && (
              <PromptDisplay title={t('allChinesePrompts')} text={activePrompt.chinesePrompt} />
            )}
          </>
        )}
      </div>
    </div>
  );
};



const DescInnovationTool: React.FC<{
  state: DescState;
  setState: React.Dispatch<React.SetStateAction<DescState>>;
  templateState: TemplateBuilderState;
  setTemplateState: React.Dispatch<React.SetStateAction<TemplateBuilderState>>;
  descControlRef?: React.MutableRefObject<DescControlHandlers | null>;
  textModel: string;
}> = ({ state, setState, templateState, setTemplateState, descControlRef, textModel }) => {
  const { t } = useTranslation();
  const { getAiInstance, isKeySet } = useApi();
  const { showChineseMap, chineseOutputsMap, isTranslatingMap, showAllChinese, toggleEntryChinese, toggleAllChinese } = useDescChinese();
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [collapsedEntryIds, setCollapsedEntryIds] = useState<string[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [entriesCollapsed, setEntriesCollapsed] = useState(false);

  // 描述词创新指令模版选择
  const [selectedDescTemplateId, setSelectedDescTemplateId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'system_default';
    try {
      return localStorage.getItem('descInnovation_selectedTemplateId') || 'system_default';
    } catch {
      return 'system_default';
    }
  });

  const pauseRef = useRef(state.isPaused);
  const cancelRef = useRef(false);

  useEffect(() => {
    pauseRef.current = state.isPaused;
  }, [state.isPaused]);

  useEffect(() => {
    cancelRef.current = false;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        DESC_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          prompt: state.descPrompt,
          count: state.count,
          splitChar: state.splitChar || '',
        })
      );
    } catch (e) {
      // Safely ignore storage errors
    }
  }, [state.descPrompt, state.count, state.splitChar]);

  // 保存描述词创新模版选择到localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('descInnovation_selectedTemplateId', selectedDescTemplateId);
    } catch (e) {
      console.warn('Failed to save desc template selection', e);
    }
  }, [selectedDescTemplateId]);

  // 获取选中的描述词创新指令模版内容
  const getSelectedDescTemplateText = () => {
    if (selectedDescTemplateId === 'system_default') {
      return state.descPrompt; // 使用当前输入的指令
    }
    const selectedTemplate = templateState.savedTemplates.find(t => t.id === selectedDescTemplateId);
    if (selectedTemplate) {
      return buildCombinedTemplateText(selectedTemplate.sections, selectedTemplate.values);
    }
    return state.descPrompt;
  };

  // 当选择模版时，更新输入框显示模版内容
  useEffect(() => {
    if (selectedDescTemplateId !== 'system_default') {
      const selectedTemplate = templateState.savedTemplates.find(t => t.id === selectedDescTemplateId);
      if (selectedTemplate) {
        const templateText = buildCombinedTemplateText(selectedTemplate.sections, selectedTemplate.values);
        setState(prev => ({ ...prev, descPrompt: templateText }));
      }
    }
    // 注意：选择"当前输入的指令"时不自动修改输入框，让用户保持自己输入的内容
  }, [selectedDescTemplateId, templateState.savedTemplates]);

  useEffect(() => {
    setSelectedEntries(prev => prev.filter(id => state.entries.some(entry => entry.id === id)));
    setCollapsedEntryIds(prev => prev.filter(id => state.entries.some(entry => entry.id === id)));
  }, [state.entries]);

  const getEntryOutputs = (entry: DescEntry) => entry.outputs.filter(Boolean);


  const copyText = (text: string) => {
    if (!text?.trim()) return;
    navigator.clipboard?.writeText(text).catch(() => { });
  };

  const updateEntry = (id: string, patch: Partial<DescEntry>) => {
    setState(prev => ({
      ...prev,
      entries: prev.entries.map(entry => entry.id === id ? { ...entry, ...patch } : entry)
    }));
  };

  const handleCopyAllOutputs = () => {
    const allOutputs = state.entries.flatMap(entry => entry.outputs).filter(Boolean);
    if (!allOutputs.length) return;
    navigator.clipboard.writeText(allOutputs.join('\n')).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    });
  };

  const addEntry = (source = '') => {
    setState(prev => ({ ...prev, entries: [...prev.entries, createDescEntry(source)] }));
  };

  const handleClearEntries = () => {
    setState(prev => ({ ...prev, entries: [createDescEntry()] }));
  };

  const removeEntry = (id: string) => {
    setState(prev => {
      const filtered = prev.entries.filter(entry => entry.id !== id);
      return { ...prev, entries: filtered.length ? filtered : [createDescEntry()] };
    });
    setSelectedEntries(prev => prev.filter(entryId => entryId !== id));
  };

  const toggleEntrySelection = (id: string) => {
    setSelectedEntries(prev => (
      prev.includes(id) ? prev.filter(entryId => entryId !== id) : [...prev, id]
    ));
  };

  const handleRemoveSelected = () => {
    if (!selectedEntries.length) return;
    setState(prev => {
      const filtered = prev.entries.filter(entry => !selectedEntries.includes(entry.id));
      return { ...prev, entries: filtered.length ? filtered : [createDescEntry()] };
    });
    setSelectedEntries([]);
  };

  const handleBulkAdd = () => {
    const lines = state.bulkInput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    if (!lines.length) return;

    setState(prev => ({
      ...prev,
      entries: [
        ...prev.entries,
        ...lines.map(line => createDescEntry(line))
      ],
      bulkInput: ''
    }));
  };

  const toggleEntryCollapse = (entryId: string) => {
    setCollapsedEntryIds(prev =>
      prev.includes(entryId) ? prev.filter(id => id !== entryId) : [...prev, entryId]
    );
  };

  const handleCopyOutputs = (entryId: string, outputs: string[]) => {
    if (!outputs.length) return;
    navigator.clipboard.writeText(outputs.join('\n')).then(() => {
      setCopiedEntryId(entryId);
      setTimeout(() => setCopiedEntryId(null), 2000);
    });
  };

  const waitIfPaused = async () => {
    while (pauseRef.current && !cancelRef.current) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  };

  const handleTogglePause = () => {
    if (!state.isProcessing) return;
    setState(prev => {
      const nextPaused = !prev.isPaused;
      return {
        ...prev,
        isPaused: nextPaused,
        controlNotice: nextPaused ? t('descPauseNotice') : null,
      };
    });
  };

  const handleGenerate = useCallback(async (entryIds?: string[]) => {
    if (state.isProcessing) return;

    const targets = (entryIds ?? state.entries.map(entry => entry.id))
      .map(id => state.entries.find(entry => entry.id === id))
      .filter((entry): entry is DescEntry => !!entry && !!entry.source.trim());

    if (!targets.length) {
      setState(prev => ({ ...prev, error: t('descErrorNoInput') }));
      return;
    }

    if (!isKeySet) {
      setState(prev => ({ ...prev, error: t('error_apiKeyNotSet') }));
      return;
    }

    const promptTemplate = getSelectedDescTemplateText();
    const splitChar = state.splitChar.trim();
    const iterations = Math.max(1, Number(state.count) || 1);

    cancelRef.current = false;
    setState(prev => ({ ...prev, isProcessing: true, isPaused: false, error: null, controlNotice: null }));

    let shouldNotify = false;
    try {
      const ai = getAiInstance();
      for (const entry of targets) {
        if (cancelRef.current) break;
        await waitIfPaused();
        updateEntry(entry.id, { status: 'processing', error: null });
        try {
          const outputs: string[] = [];
          for (let i = 0; i < iterations; i++) {
            if (cancelRef.current) break;
            await waitIfPaused();
            console.log(`🤖 [Desc Tool] Using AI model: ${textModel}`);
            const response = await ai.models.generateContent({
              model: textModel,
              contents: { parts: [{ text: `${promptTemplate}\n\n原始描述词：${entry.source.trim()}` }] },
            });
            const rawText = (response.text || '').trim();
            if (!rawText) {
              throw new Error(t('error_invalidPrompt'));
            }
            if (splitChar) {
              rawText.split(splitChar).map(part => part.trim()).filter(Boolean).forEach(part => outputs.push(part));
            } else {
              outputs.push(rawText);
            }
          }
          updateEntry(entry.id, { outputs, status: 'success' });
        } catch (err: any) {
          const message = err?.message || String(err);
          updateEntry(entry.id, { status: 'error', error: message });
        }
      }
      shouldNotify = state.shouldPlayCompletionSound && !cancelRef.current;
    } catch (err: any) {
      const message = err?.message || String(err);
      setState(prev => ({ ...prev, error: message }));
    } finally {
      if (shouldNotify) {
        playCompletionTone();
      }
      cancelRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false, isPaused: false, shouldPlayCompletionSound: false }));
    }
  }, [getAiInstance, isKeySet, state.count, state.descPrompt, state.entries, state.splitChar, state.shouldPlayCompletionSound, t, textModel]);

  const handleGenerateRef = useRef(handleGenerate);
  useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);

  useEffect(() => {
    if (state.pendingAutoGenerate && !state.isProcessing) {
      setState(prev => ({ ...prev, pendingAutoGenerate: false }));
      handleGenerateRef.current();
    }
  }, [state.pendingAutoGenerate, state.isProcessing, setState]);

  const handleStop = () => {
    if (!state.isProcessing) return;
    cancelRef.current = true;
    setState(prev => ({ ...prev, isPaused: false, controlNotice: t('descStopNotice') }));
  };

  useEffect(() => {
    if (!descControlRef) return;
    descControlRef.current = {
      togglePause: handleTogglePause,
      stop: handleStop,
    };
    return () => {
      if (descControlRef.current) {
        descControlRef.current = null;
      }
    };
  }, [descControlRef, handleTogglePause, handleStop]);

  const statusLabels: Record<DescEntryStatus, string> = {
    idle: t('descStatusIdle'),
    processing: t('descStatusProcessing'),
    success: t('descStatusSuccess'),
    error: t('descStatusError'),
  };

  return (
    <>
      <div className="tool-container desc-tool">
        <ToolHeader title={t('descTitle')} description={t('descDescription')} />
        {state.error && <div className="error-message">{state.error}</div>}
        <div className="desc-layout">
          <div className="desc-collapse-toggle">
            <button
              className="secondary-btn"
              type="button"
              onClick={() => setEntriesCollapsed(prev => !prev)}
            >
              {entriesCollapsed ? t('descExpandEntries') : t('descCollapseEntries')}
            </button>
            {entriesCollapsed && <span className="desc-collapse-note">{t('descEntriesHidden')}</span>}
          </div>
          <div className="desc-settings">
            {/* 指令模版选择器 */}
            <div className="setting-group">
              <label>创新指令模版</label>
              <select
                value={selectedDescTemplateId}
                onChange={(e) => setSelectedDescTemplateId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--control-bg-color)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  marginBottom: '0.5rem'
                }}
              >
                <option value="system_default">当前输入的指令</option>
                {templateState.savedTemplates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name || '未命名模版'}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted-color)', marginBottom: '1rem' }}>
                {selectedDescTemplateId === 'system_default'
                  ? '使用下方输入框中的指令'
                  : `使用 "${templateState.savedTemplates.find(t => t.id === selectedDescTemplateId)?.name || '自定义'}" 模版`}
              </div>
            </div>

            <div className="setting-group">
              <div className="desc-prompt-header">
                <label>{t('descPromptLabel')}</label>
                <button className="secondary-btn" type="button" onClick={() => setShowTemplateModal(true)}>
                  {t('descEditTemplate')}
                </button>
              </div>
              <textarea
                rows={12}
                value={state.descPrompt}
                onChange={e => setState(prev => ({ ...prev, descPrompt: e.target.value }))}
                placeholder={t('descPromptPlaceholder')}
              />
            </div>
            <div className="setting-group">
              <label>{t('descCountLabel')}</label>
              <input
                type="number"
                min={1}
                value={state.count}
                onChange={e => {
                  const val = Math.max(1, Number(e.target.value) || 1);
                  setState(prev => ({ ...prev, count: val }));
                }}
              />
            </div>
            <div className="setting-group">
              <label>{t('descSplitCharLabel')}</label>
              <input
                type="text"
                value={state.splitChar}
                onChange={e => setState(prev => ({ ...prev, splitChar: e.target.value }))}
              />
            </div>
            <div className="setting-group">
              <label>{t('descBulkLabel')}</label>
              <textarea
                rows={5}
                value={state.bulkInput}
                onChange={e => setState(prev => ({ ...prev, bulkInput: e.target.value }))}
                placeholder={t('descBulkPlaceholder')}
              />
              <div className="desc-bulk-controls">
                <button className="secondary-btn" onClick={handleBulkAdd} disabled={!state.bulkInput.trim()}>
                  {t('descBulkAdd')}
                </button>
                <button className="secondary-btn" onClick={() => addEntry()}>
                  {t('descAddEntry')}
                </button>
              </div>
            </div>
            <button className="primary" onClick={() => handleGenerate()} disabled={state.isProcessing}>
              {state.isProcessing ? t('descStatusProcessing') : t('descGenerateAll')}
            </button>
            <button
              className="secondary-btn"
              type="button"
              onClick={handleTogglePause}
              disabled={!state.isProcessing}
            >
              {state.isPaused ? t('descResume') : t('descPause')}
            </button>
            <button
              className="secondary-btn error-btn"
              type="button"
              onClick={handleStop}
              disabled={!state.isProcessing}
            >
              {t('descStop')}
            </button>
            {state.controlNotice && (
              <div className="desc-control-notice">{state.controlNotice}</div>
            )}
          </div>
          <div className="desc-batch-actions">
            <button
              className="secondary-btn error-btn"
              onClick={handleRemoveSelected}
              disabled={selectedEntries.length === 0}
            >
              {t('descRemoveSelected')}
            </button>
            <button
              className="secondary-btn error-btn"
              onClick={handleClearEntries}
              disabled={state.entries.length === 1 && !state.entries[0].source.trim() && state.entries[0].outputs.length === 0}
            >
              {t('descClearAll')}
            </button>
            <button
              className="secondary-btn"
              onClick={toggleAllChinese}
              disabled={!state.entries.some(entry => entry.outputs.some(Boolean))}
            >
              {showAllChinese ? t('hideAllChinesePrompts') : t('showAllChinesePrompts')}
            </button>
            <button
              className="secondary-btn"
              onClick={handleCopyAllOutputs}
              disabled={state.entries.every(entry => entry.outputs.length === 0)}
            >
              {copiedAll ? t('copied') : t('descCopyBatch')}
            </button>
          </div>
          <div className={`desc-entries-list ${entriesCollapsed ? 'collapsed' : ''}`}>
            {state.entries.map(entry => {
              const isEntryCollapsed = collapsedEntryIds.includes(entry.id);
              const entryToggleLabel = isEntryCollapsed ? t('descExpandEntries') : t('descCollapseEntries');
              return (
                <div key={entry.id} className="desc-entry-card">
                  <div className="desc-entry-header">
                    <label className="desc-entry-select">
                      <input
                        type="checkbox"
                        checked={selectedEntries.includes(entry.id)}
                        onChange={() => toggleEntrySelection(entry.id)}
                      />
                    </label>
                    <span className={`desc-status-chip ${entry.status}`}>{statusLabels[entry.status]}</span>
                    <div className="desc-entry-actions">
                      <button
                        className="secondary-btn"
                        type="button"
                        onClick={() => toggleEntryCollapse(entry.id)}
                        aria-expanded={!isEntryCollapsed}
                        title={entryToggleLabel}
                        aria-label={entryToggleLabel}
                      >
                        {isEntryCollapsed ? '折叠' : '展开'}
                      </button>
                      <button className="secondary-btn" onClick={() => handleGenerate([entry.id])} disabled={state.isProcessing}>
                        {t('descRunEntry')}
                      </button>
                      <button className="secondary-btn error-btn" onClick={() => removeEntry(entry.id)}>
                        {t('descRemoveEntry')}
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={entry.source}
                    onChange={e => updateEntry(entry.id, { source: e.target.value })}
                    placeholder={t('descEntryPlaceholder')}
                  />
                  {isEntryCollapsed ? (
                    <div className="desc-entry-collapsed-note">{t('descEntriesHidden')}</div>
                  ) : entry.outputs.length > 0 ? (
                    (() => {
                      const englishOutputs = getEntryOutputs(entry);
                      const translationOutputs = chineseOutputsMap[entry.id] || englishOutputs;
                      const showChinese = showChineseMap[entry.id];
                      return (
                        <div className="desc-entry-outputs">
                          <div className="desc-entry-footer">
                            <strong>{t('descOutputsLabel')}</strong>
                            <button className="secondary-btn" onClick={() => handleCopyOutputs(entry.id, entry.outputs)}>
                              {copiedEntryId === entry.id ? t('copied') : t('descCopyAll')}
                            </button>
                            {englishOutputs.length > 0 && (
                              <button
                                className="secondary-btn"
                                onClick={() => toggleEntryChinese(entry)}
                                disabled={isTranslatingMap[entry.id]}
                              >
                                {showChinese ? t('hideChinesePrompts') : t('showChinesePrompts')}
                              </button>
                            )}
                            {isTranslatingMap[entry.id] && <span className="desc-translation-label">{t('descStatusProcessing')}</span>}
                          </div>
                          <div className="desc-output-columns">
                            {englishOutputs.map((output, index) => {
                              const translation = translationOutputs[index] || output;
                              const showHint = !showChinese && index === 0;
                              const displayLoader = isTranslatingMap[entry.id] && index === 0;
                              return (
                                <div key={`paired-${index}`} className="desc-output-row">
                                  <div className="desc-output-cell desc-output-english">
                                    <div>{output}</div>
                                    <div className="desc-output-actions">
                                      <button
                                        className="secondary-btn"
                                        type="button"
                                        onClick={() => copyText(output)}
                                      >
                                        {t('copy')}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="desc-output-cell desc-output-chinese">
                                    {displayLoader ? (
                                      <div className="desc-translation-loading">
                                        <Loader small />
                                      </div>
                                    ) : showChinese ? (
                                      <div>{translation}</div>
                                    ) : showHint ? (
                                      <p className="desc-muted desc-chinese-hint">
                                        {t('descChineseHiddenHint')}
                                      </p>
                                    ) : (
                                      <span aria-hidden="true">&nbsp;</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <p className="desc-muted">{t('descNoOutputs')}</p>
                  )}
                  {entry.error && <div className="error-message">{entry.error}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {showTemplateModal && (
        <TemplateBuilderModal state={templateState} setState={setTemplateState} onClose={() => setShowTemplateModal(false)} />
      )}
    </>
  );
};

const TemplateBuilderView: React.FC<{
  state: TemplateBuilderState;
  setState: React.Dispatch<React.SetStateAction<TemplateBuilderState>>;
  showHeader?: boolean;
  onClose?: () => void;
}> = ({ state, setState, showHeader = true, onClose }) => {
  const { t } = useTranslation();
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionContent, setNewSectionContent] = useState('');
  const [newVersionName, setNewVersionName] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const [renamingVersionId, setRenamingVersionId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 简单模式相关状态
  const [isSimpleMode, setIsSimpleMode] = useState(true);
  const [simpleTemplateName, setSimpleTemplateName] = useState('');
  const [simpleTemplateInstruction, setSimpleTemplateInstruction] = useState('');
  const [simpleModeSaveMessage, setSimpleModeSaveMessage] = useState<string | null>(null);

  const filteredSections = useMemo(() => {
    if (!state.search.trim()) {
      return state.sections;
    }
    const query = state.search.trim().toLowerCase();
    return state.sections.filter(section => {
      const currentValue = (state.values[section.id] || '').toLowerCase();
      return section.title.toLowerCase().includes(query) || currentValue.includes(query);
    });
  }, [state.search, state.values, state.sections]);

  const combinedText = useMemo(
    () => buildCombinedTemplateText(state.sections, state.values),
    [state.sections, state.values]
  );

  const handleValueChange = (id: string, value: string) => {
    setState(prev => ({ ...prev, values: { ...prev.values, [id]: value } }));
  };

  const handleResetAll = () => {
    const defaultSections = getDefaultTemplateSections();
    const defaultValues = getDefaultTemplateValues();
    const defaultTemplate = createDefaultTemplateVersion();
    setState(prev => {
      const hasDefault = prev.savedTemplates.some(template => template.id === DEFAULT_TEMPLATE_VERSION_ID);
      const updatedTemplates = hasDefault
        ? prev.savedTemplates.map(template =>
          template.id === DEFAULT_TEMPLATE_VERSION_ID
            ? { ...template, sections: cloneSections(defaultSections), values: cloneValues(defaultValues) }
            : template
        )
        : [...prev.savedTemplates, defaultTemplate];

      const targetVersionId = DEFAULT_TEMPLATE_VERSION_ID;
      const targetVersion = updatedTemplates.find(template => template.id === targetVersionId) || updatedTemplates[0];

      return {
        ...prev,
        search: '',
        sections: cloneSections(targetVersion.sections),
        values: cloneValues(targetVersion.values),
        savedTemplates: updatedTemplates,
        activeVersionId: targetVersion.id,
      };
    });
  };

  const activeVersion = state.savedTemplates.find(template => template.id === state.activeVersionId)
    ?? state.savedTemplates[0];
  const isRenamingActive = renamingVersionId === activeVersion?.id;

  const handleRestoreDefault = (section: TemplateSectionDefinition) => {
    const fallback = TEMPLATE_BASE_VALUES[section.id] ?? section.defaultValue ?? '';
    setState(prev => ({ ...prev, values: { ...prev.values, [section.id]: fallback } }));
  };

  const handleRemoveSection = (id: string) => {
    setState(prev => {
      const newSections = prev.sections.filter(section => section.id !== id);
      const newValues = { ...prev.values };
      delete newValues[id];
      return { ...prev, sections: newSections, values: newValues };
    });
  };

  const handleAddSection = () => {
    if (!newSectionTitle.trim() || !newSectionContent.trim()) return;
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newSection: TemplateSectionDefinition = {
      id,
      title: newSectionTitle.trim(),
      defaultValue: newSectionContent,
      isCustom: true,
    };
    setState(prev => ({
      ...prev,
      sections: [...prev.sections, newSection],
      values: { ...prev.values, [id]: newSectionContent },
    }));
    setNewSectionTitle('');
    setNewSectionContent('');
  };

  const handleVersionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = event.target.value;
    const version = state.savedTemplates.find(template => template.id === selectedId);
    if (!version) return;
    setState(prev => ({
      ...prev,
      sections: cloneSections(version.sections),
      values: cloneValues(version.values),
      activeVersionId: version.id,
    }));
  };

  const handleSaveVersion = () => {
    const trimmedName = newVersionName.trim();
    if (!trimmedName) return;
    setState(prev => {
      const newId = `version-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const newVersion: SavedTemplateVersion = {
        id: newId,
        name: trimmedName,
        sections: cloneSections(prev.sections),
        values: cloneValues(prev.values),
      };
      return {
        ...prev,
        savedTemplates: [...prev.savedTemplates, newVersion],
        activeVersionId: newId,
      };
    });
    setNewVersionName('');
  };

  const handleOverwriteVersion = () => {
    if (!activeVersion) return;
    setState(prev => ({
      ...prev,
      savedTemplates: prev.savedTemplates.map(template =>
        template.id === activeVersion.id
          ? { ...template, sections: cloneSections(prev.sections), values: cloneValues(prev.values) }
          : template
      ),
    }));
  };

  const startRenameVersion = () => {
    if (!activeVersion) return;
    setRenamingVersionId(activeVersion.id);
    setRenamingValue(activeVersion.name);
  };

  const cancelRenameVersion = () => {
    setRenamingVersionId(null);
    setRenamingValue('');
  };

  const confirmRenameVersion = () => {
    if (!activeVersion) return;
    const newName = renamingValue.trim();
    if (!newName) return;
    setState(prev => ({
      ...prev,
      savedTemplates: prev.savedTemplates.map(template =>
        template.id === activeVersion.id ? { ...template, name: newName } : template
      ),
    }));
    cancelRenameVersion();
  };

  const handleRenameInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmRenameVersion();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRenameVersion();
    }
  };

  useEffect(() => {
    if (isRenamingActive) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenamingActive]);

  useEffect(() => {
    if (renamingVersionId && activeVersion?.id !== renamingVersionId) {
      setRenamingVersionId(null);
      setRenamingValue('');
    }
  }, [activeVersion?.id, renamingVersionId]);

  const handleDeleteVersion = () => {
    if (!activeVersion || state.savedTemplates.length <= 1) return;
    setState(prev => {
      const nextTemplates = prev.savedTemplates.filter(template => template.id !== activeVersion.id);
      const nextVersion = nextTemplates[0];
      return {
        ...prev,
        savedTemplates: nextTemplates,
        activeVersionId: nextVersion.id,
        sections: cloneSections(nextVersion.sections),
        values: cloneValues(nextVersion.values),
      };
    });
  };

  const handleExportVersions = () => {
    // 只导出用户自定义的模版，排除系统默认模版
    const payload = state.savedTemplates
      .filter(template => template.id !== DEFAULT_TEMPLATE_VERSION_ID)
      .map(template => ({
        id: template.id,
        name: template.name,
        sections: template.sections,
        values: template.values,
      }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = URL.createObjectURL(blob);
    link.download = `template-versions-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const handleImportVersions = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const imported = JSON.parse(text);
        if (!Array.isArray(imported)) {
          throw new Error('Invalid format');
        }
        const sanitized: SavedTemplateVersion[] = imported.map((template: any) => ({
          id: `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: template.name || `Imported ${Date.now()}`,
          sections: Array.isArray(template.sections)
            ? template.sections.map((section: TemplateSectionDefinition) => ({ ...section }))
            : [],
          values: typeof template.values === 'object' && template.values ? { ...template.values } : {},
        })).filter(template => template.sections.length > 0);
        if (!sanitized.length) return;
        const first = sanitized[0];
        setState(prev => ({
          ...prev,
          savedTemplates: [...prev.savedTemplates, ...sanitized],
          activeVersionId: first.id,
          sections: cloneSections(first.sections),
          values: cloneValues(first.values),
        }));
      } catch (err) {
        console.error("Failed to import template versions", err);
        alert("Failed to import template versions. Make sure the file matches the exported format.");
      } finally {
        if (importInputRef.current) {
          importInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  // 简单模式保存处理
  const handleSimpleModeSave = () => {
    const trimmedName = simpleTemplateName.trim();
    const trimmedInstruction = simpleTemplateInstruction.trim();
    if (!trimmedName || !trimmedInstruction) return;

    const newId = `simple-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sectionId = `simple-section-${Date.now()}`;

    // 创建一个只包含单个 section 的简单模版
    const newSection: TemplateSectionDefinition = {
      id: sectionId,
      title: trimmedName,
      defaultValue: trimmedInstruction,
      isCustom: true,
    };

    const newVersion: SavedTemplateVersion = {
      id: newId,
      name: trimmedName,
      sections: [newSection],
      values: { [sectionId]: trimmedInstruction },
    };

    setState(prev => ({
      ...prev,
      savedTemplates: [...prev.savedTemplates, newVersion],
      activeVersionId: newId,
      sections: [newSection],
      values: { [sectionId]: trimmedInstruction },
    }));

    // 清空输入并显示成功消息
    setSimpleTemplateName('');
    setSimpleTemplateInstruction('');
    setSimpleModeSaveMessage(t('simpleTemplateUpdateSuccess'));
    setTimeout(() => setSimpleModeSaveMessage(null), 2000);
  };

  return (
    <div className="template-builder">
      {showHeader ? (
        <ToolHeader
          title={isSimpleMode ? t('simpleTemplateTitle') : t('templateTitle')}
          description={isSimpleMode ? '' : t('templateDescription')}
          actions={
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="secondary-btn"
                onClick={() => setIsSimpleMode(!isSimpleMode)}
                style={{
                  background: isSimpleMode ? 'var(--primary-color)' : undefined,
                  color: isSimpleMode ? 'white' : undefined
                }}
              >
                {isSimpleMode ? t('advancedTemplateToggle') : t('simpleTemplateToggle')}
              </button>
              {!isSimpleMode && (
                <button className="secondary-btn" onClick={handleResetAll}>
                  {t('templateResetAll')}
                </button>
              )}
            </div>
          }
        />
      ) : (
        <div className="template-modal-header">
          <h3>{isSimpleMode ? t('simpleTemplateTitle') : t('templateTitle')}</h3>
          <div className="template-modal-actions">
            <button
              className="secondary-btn"
              onClick={() => setIsSimpleMode(!isSimpleMode)}
            >
              {isSimpleMode ? t('advancedTemplateToggle') : t('simpleTemplateToggle')}
            </button>
            {!isSimpleMode && (
              <button className="secondary-btn" onClick={handleResetAll}>{t('templateResetAll')}</button>
            )}
            <button className="modal-close-btn" onClick={onClose} aria-label="close">&times;</button>
          </div>
        </div>
      )}

      {/* 简单模式 - 普通指令模版设置 */}
      {isSimpleMode ? (
        <div className="simple-template-form" style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          padding: '1.5rem',
          background: 'var(--surface-color)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          marginTop: '1rem'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontWeight: 600, color: 'var(--text-color)' }}>
              {t('simpleTemplateNameLabel')}
            </label>
            <input
              type="text"
              value={simpleTemplateName}
              onChange={e => setSimpleTemplateName(e.target.value)}
              placeholder={t('simpleTemplateNamePlaceholder')}
              style={{
                padding: '0.75rem',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                background: 'var(--control-bg-color)',
                color: 'var(--text-color)',
                fontSize: '1rem'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontWeight: 600, color: 'var(--text-color)' }}>
              {t('simpleTemplateInstructionLabel')}
            </label>
            <textarea
              rows={10}
              value={simpleTemplateInstruction}
              onChange={e => setSimpleTemplateInstruction(e.target.value)}
              placeholder={t('simpleTemplateInstructionPlaceholder')}
              style={{
                padding: '0.75rem',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                background: 'var(--control-bg-color)',
                color: 'var(--text-color)',
                fontSize: '1rem',
                resize: 'vertical',
                minHeight: '200px'
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
            <button
              className="primary"
              onClick={handleSimpleModeSave}
              disabled={!simpleTemplateName.trim() || !simpleTemplateInstruction.trim()}
              style={{
                padding: '0.75rem 2rem',
                fontSize: '1rem',
                fontWeight: 600
              }}
            >
              {t('simpleTemplateSave')}
            </button>
            {simpleModeSaveMessage && (
              <span style={{
                color: 'var(--secondary-color)',
                fontWeight: 500,
                animation: 'fadeIn 0.3s ease'
              }}>
                ✓ {simpleModeSaveMessage}
              </span>
            )}
          </div>

          {/* 已保存的模版列表 */}
          {state.savedTemplates.length > 1 && (
            <div style={{
              marginTop: '1.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-color)'
            }}>
              <label style={{ fontWeight: 600, color: 'var(--text-color)', display: 'block', marginBottom: '0.5rem' }}>
                {t('templateVersionLabel')}
              </label>
              <select
                value={activeVersion?.id || state.savedTemplates[0]?.id || ''}
                onChange={handleVersionChange}
                style={{
                  padding: '0.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--background-color)',
                  color: 'var(--text-color)',
                  minWidth: '220px'
                }}
              >
                {state.savedTemplates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ) : (
        /* 高级模式 - 原有的复杂模版编辑器 */
        <>
          {/* 高级模版使用说明 */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(33, 150, 243, 0.08), rgba(156, 39, 176, 0.08))',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1.25rem',
            marginBottom: '1.5rem',
            marginTop: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <Lightbulb size={24} className="text-amber-400" />
              <div style={{ flex: 1 }}>
                <h4 style={{
                  margin: '0 0 0.75rem 0',
                  color: 'var(--text-color)',
                  fontSize: '1.1rem',
                  fontWeight: 600
                }}>
                  高级指令模版使用说明
                </h4>
                <div style={{
                  color: 'var(--text-muted-color)',
                  fontSize: '0.9rem',
                  lineHeight: '1.6'
                }}>
                  <p style={{ margin: '0 0 0.75rem 0' }}>
                    <strong style={{ color: 'var(--text-color)' }}>🎯 功能定位：</strong>
                    实现对常用各种图片类型的自动识别与创新，满足根据图片执行特定描述要求的场景。
                    <strong>让每个人都能批量生成高质量的成品图描述词。</strong>
                  </p>

                  <p style={{ margin: '0 0 0.75rem 0' }}>
                    <ClipboardList size={14} className="inline mr-1" /><strong style={{ color: 'var(--text-color)' }}>使用前提：</strong>
                    需要对每类特定图片类型的描述要求进行整理，形成规范化的指令（组内总结整理），然后填入到对应图片类型的模块中。
                  </p>

                  <p style={{ margin: '0 0 0.75rem 0' }}>
                    <Sparkles size={14} className="inline mr-1" /><strong style={{ color: 'var(--text-color)' }}>核心优势：</strong>
                  </p>
                  <ul style={{
                    margin: '0 0 0.75rem 1.25rem',
                    padding: 0,
                    listStyle: 'disc'
                  }}>
                    <li>一个指令涵盖所有常用图片类型的 AI 识别与创新</li>
                    <li>省去针对特定类型图片切换特定模版的繁琐操作</li>
                    <li>特别适合推广人员、不擅长描述或创新延伸的用户</li>
                    <li>借助组内总结整理的高级指令模版，轻松写出合格可用的 AI 描述词</li>
                  </ul>

                  <p style={{ margin: '0', opacity: 0.9 }}>
                    <Lightbulb size={14} className="inline mr-1 text-amber-400" /><strong style={{ color: 'var(--text-color)' }}>提示：</strong>
                    如果偏好为不同图片类型使用独立模版，也可以创建多个版本进行切换，根据实际使用场景灵活选择。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="template-builder-controls">
            <div className="template-version-panel">
              <div className="template-version-row">
                <label htmlFor="template-version-select">{t('templateVersionLabel')}</label>
                <select
                  id="template-version-select"
                  value={activeVersion?.id || state.savedTemplates[0]?.id || ''}
                  onChange={handleVersionChange}
                >
                  {state.savedTemplates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                {isRenamingActive ? (
                  <div className="template-version-rename">
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="template-version-rename-input"
                      value={renamingValue}
                      onChange={e => setRenamingValue(e.target.value)}
                      onKeyDown={handleRenameInputKeyDown}
                      placeholder={activeVersion?.name || t('templateRenameVersion')}
                    />
                    <button
                      className="secondary-btn"
                      onClick={confirmRenameVersion}
                      disabled={!renamingValue.trim()}
                    >
                      {t('save')}
                    </button>
                    <button className="secondary-btn" onClick={cancelRenameVersion}>
                      {t('cancel')}
                    </button>
                  </div>
                ) : (
                  <button className="secondary-btn" onClick={startRenameVersion} disabled={!activeVersion}>
                    {t('templateRenameVersion')}
                  </button>
                )}
                <button
                  className="secondary-btn error-btn"
                  onClick={handleDeleteVersion}
                  disabled={!activeVersion || state.savedTemplates.length <= 1}
                >
                  {t('templateDeleteVersion')}
                </button>
              </div>
              <div className="template-version-actions">
                <input
                  type="text"
                  value={newVersionName}
                  onChange={e => setNewVersionName(e.target.value)}
                  placeholder={t('templateNewVersionPlaceholder')}
                />
                <button
                  className="primary"
                  onClick={handleSaveVersion}
                  disabled={!newVersionName.trim()}
                >
                  {t('templateSaveVersion')}
                </button>
                <button
                  className="secondary-btn"
                  onClick={handleOverwriteVersion}
                  disabled={!activeVersion}
                >
                  {t('templateOverwriteVersion')}
                </button>
                <button className="secondary-btn" onClick={handleExportVersions}>
                  {t('templateExportVersions')}
                </button>
                <button className="secondary-btn" onClick={() => importInputRef.current?.click()}>
                  {t('templateImportVersions')}
                </button>
                <input
                  type="file"
                  ref={importInputRef}
                  style={{ display: 'none' }}
                  accept="application/json"
                  onChange={handleImportVersions}
                />
              </div>
            </div>
            <input
              type="text"
              placeholder={t('templateSearchPlaceholder')}
              value={state.search}
              onChange={e => setState(prev => ({ ...prev, search: e.target.value }))}
            />
          </div>
          <div className="template-add-section">
            <h4>{t('templateAddSection')}</h4>
            <div className="template-add-fields">
              <input
                type="text"
                placeholder={t('templateSectionTitlePlaceholder')}
                value={newSectionTitle}
                onChange={e => setNewSectionTitle(e.target.value)}
              />
              <textarea
                rows={4}
                placeholder={t('templateSectionContentPlaceholder')}
                value={newSectionContent}
                onChange={e => setNewSectionContent(e.target.value)}
              />
              <button
                className="primary"
                onClick={handleAddSection}
                disabled={!newSectionTitle.trim() || !newSectionContent.trim()}
              >
                {t('templateCreateSection')}
              </button>
            </div>
          </div>
          <div className="template-section-list">
            {filteredSections.length === 0 ? (
              <div className="template-empty">{t('templateNoMatch')}</div>
            ) : (
              filteredSections.map(section => (
                <div className="template-section-card" key={section.id}>
                  <div className="template-section-header">
                    <h4>{section.title}</h4>
                    <div className="template-section-actions">
                      <button
                        className="secondary-btn"
                        onClick={() => handleRestoreDefault(section)}
                        disabled={(state.values[section.id] || '').trim() === ((TEMPLATE_BASE_VALUES[section.id] ?? section.defaultValue ?? '')).trim()}
                      >
                        {t('templateRestoreSection')}
                      </button>
                      <button
                        className="secondary-btn error-btn"
                        onClick={() => handleRemoveSection(section.id)}
                        disabled={state.sections.length <= 1}
                      >
                        {t('templateDeleteSection')}
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={Math.min(12, Math.max(4, Math.ceil((state.values[section.id] || '').split('\n').length)))}
                    value={state.values[section.id] || ''}
                    onChange={e => handleValueChange(section.id, e.target.value)}
                  />
                </div>
              ))
            )}
          </div>
          <div className="template-preview">
            <PromptDisplay title={t('templatePreviewTitle')} text={combinedText} />
          </div>
        </>
      )}
    </div>
  );
};

const TemplateBuilderTool: React.FC<{
  state: TemplateBuilderState;
  setState: React.Dispatch<React.SetStateAction<TemplateBuilderState>>;
  presetUser: string;
  registerSaveHandler?: (handler: (() => void) | null) => void;
  onSaveStatusChange?: (status: PresetSaveStatus | null) => void;
}> = ({ state, setState, presetUser, registerSaveHandler, onSaveStatusChange }) => {
  const { t } = useTranslation();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState(false);
  const [skipSaveConfirm, setSkipSaveConfirm] = useState(() => getShouldSkipPresetSaveConfirm());
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const pendingSaveActionRef = useRef<(() => void) | null>(null);
  const lastSyncedUserRef = useRef<string | null>(null);

  const statusMessage =
    saveError ||
    syncError ||
    (isSaving ? t('presetSaving') : isSyncing ? t('presetSyncing') : saveMessage || syncMessage);
  const statusClass = (saveError || syncError) ? 'error' : 'success';
  const confirmUserLabel = presetUser.trim() || t('presetUserPlaceholder');

  const requestSaveConfirmation = (action: () => void) => {
    if (skipSaveConfirm) {
      action();
      return;
    }
    pendingSaveActionRef.current = action;
    setDontAskAgain(false);
    setIsSaveConfirmOpen(true);
  };

  const handleConfirmSave = () => {
    setIsSaveConfirmOpen(false);
    if (dontAskAgain && !skipSaveConfirm) {
      setShouldSkipPresetSaveConfirm(true);
      setSkipSaveConfirm(true);
    }
    const action = pendingSaveActionRef.current;
    pendingSaveActionRef.current = null;
    action?.();
  };

  const handleCancelSaveConfirm = () => {
    setIsSaveConfirmOpen(false);
    setDontAskAgain(false);
    pendingSaveActionRef.current = null;
  };

  const handleSyncFromSheet = useCallback(async () => {
    const user = presetUser.trim();
    if (!user) {
      setSyncError(t('presetUserRequired'));
      setSyncMessage(null);
      return;
    }
    if (!isValidPresetUser(user)) {
      setSyncError(t('presetUserMustBeGmail'));
      setSyncMessage(null);
      return;
    }

    setIsSyncing(true);
    setSyncError(null);
    setSyncMessage(null);

    try {
      console.log('Syncing templates for user:', user);
      const rows = await fetchUserPresetsFromSheet(user, SHARED_PRESET_SHEET_CONFIG);
      console.log('Fetched rows from sheet:', rows);

      // 1. Find the State Row (TemplateBuilder)
      let stateRows = extractScopedRows(rows, PRESET_SCOPE_TEMPLATE)
        .filter(r => r.category === 'TemplateBuilder');

      // Fallback: check for unscoped 'TemplateBuilder' category (Legacy V0)
      if (stateRows.length === 0) {
        const legacyRows = rows.filter(r => r.category === 'TemplateBuilder');
        if (legacyRows.length > 0) {
          stateRows = legacyRows;
        }
      }

      if (!stateRows.length) {
        console.log('No matching state rows found');
        setSyncMessage(t('presetSheetEmpty'));
        return;
      }

      // Get the latest state row
      const latestStateRow = stateRows[stateRows.length - 1];
      console.log('Latest state row:', latestStateRow);

      let parsedState: { templates: SavedTemplateVersion[]; activeTemplate: SavedTemplateVersion } | null = null;

      try {
        const payload = latestStateRow.prompt ? JSON.parse(latestStateRow.prompt) : null;

        // Check for V2 format (Split Rows)
        if (payload && payload.version === 'v2' && payload.batchId) {
          console.log('Detected V2 format with batchId:', payload.batchId);
          const targetBatchId = payload.batchId;

          // Find all TemplateItem rows
          const itemRows = extractScopedRows(rows, PRESET_SCOPE_TEMPLATE)
            .filter(r => r.category === 'TemplateItem');

          // Filter items by batchId
          const matchedTemplates = itemRows
            .map(r => {
              try { return JSON.parse(r.prompt); } catch { return null; }
            })
            .filter(t => t && t.batchId === targetBatchId)
            .map((t, index) => sanitizeTemplateVersionFromSheet(t, index))
            .filter((t): t is SavedTemplateVersion => !!t);

          console.log('Matched V2 templates:', matchedTemplates);

          if (matchedTemplates.length > 0) {
            // Reorder based on templateIds in state payload if available
            let orderedTemplates = matchedTemplates;
            if (Array.isArray(payload.templateIds)) {
              orderedTemplates = payload.templateIds
                .map((id: string) => matchedTemplates.find(t => t.id === id))
                .filter((t: SavedTemplateVersion | undefined): t is SavedTemplateVersion => !!t);

              // Append any found templates that weren't in the ID list (just in case)
              matchedTemplates.forEach(t => {
                if (!orderedTemplates.find(ot => ot.id === t.id)) {
                  orderedTemplates.push(t);
                }
              });
            }

            const activeId = payload.activeVersionId || orderedTemplates[0].id;
            const activeTemplate = orderedTemplates.find(t => t.id === activeId) || orderedTemplates[0];

            parsedState = {
              templates: orderedTemplates,
              activeTemplate: activeTemplate
            };
          }
        }

        // Fallback to V1 parsing if V2 failed or not detected
        if (!parsedState) {
          console.log('Falling back to V1 parsing');
          parsedState = parseTemplateSheetPayload(payload);
        }
      } catch (e) {
        console.error('Error parsing template payload:', e);
      }

      if (!parsedState) {
        setSyncError(t('presetSaveError'));
        return;
      }

      const { templates, activeTemplate } = parsedState;

      setState(prev => {
        // 确保云端加载的模版与默认模版共存
        let mergedTemplates = templates.map(template => ({
          ...template,
          sections: cloneSections(template.sections),
          values: cloneValues(template.values)
        }));

        // 检查是否有默认模版，如果没有则添加
        const hasDefaultTemplate = mergedTemplates.some(t => t.id === DEFAULT_TEMPLATE_VERSION_ID);
        if (!hasDefaultTemplate) {
          // 创建默认模版并添加到列表开头
          const defaultTemplate = createDefaultTemplateVersion();
          mergedTemplates = [defaultTemplate, ...mergedTemplates];
        } else {
          // 确保默认模版的名称是最新的
          mergedTemplates = mergedTemplates.map(t =>
            t.id === DEFAULT_TEMPLATE_VERSION_ID
              ? { ...t, name: DEFAULT_TEMPLATE_VERSION_NAME }
              : t
          );
        }

        return {
          ...prev,
          savedTemplates: mergedTemplates,
          sections: cloneSections(activeTemplate.sections),
          values: cloneValues(activeTemplate.values),
          activeVersionId: activeTemplate.id,
          search: ''
        };
      });
      setSyncMessage(t('presetSyncSuccess', { count: templates.length.toString() }));
    } catch (err: any) {
      console.error('Sync template builder from sheet failed:', err);
      setSyncError(err?.message || t('presetSaveError'));
    } finally {
      setIsSyncing(false);
    }
  }, [presetUser, setState, t]);

  const handleSaveTemplatesToSheet = useCallback(() => {
    const user = presetUser.trim();
    if (!user) {
      setSaveError(t('presetUserRequired'));
      setSaveMessage(null);
      return;
    }
    if (!isValidPresetUser(user)) {
      setSaveError(t('presetUserMustBeGmail'));
      setSaveMessage(null);
      return;
    }

    const rows = buildTemplateSheetRows(state);
    console.log('Saving template rows:', rows);
    console.log('Current state savedTemplates:', state.savedTemplates);

    if (!rows.length) {
      setSaveError(t('presetSaveNoData'));
      setSaveMessage(null);
      return;
    }

    // Check payload size
    const payloadSize = rows[0].prompt.length;
    if (payloadSize > 45000) {
      if (!confirm(`警告：您的模版数据量较大 (${payloadSize} 字符)，可能会超过 Google Sheet 的单元格限制 (50000 字符)。保存可能会失败。是否继续尝试？`)) {
        return;
      }
    }

    const executeSave = async () => {
      setIsSaving(true);
      setSaveError(null);
      setSaveMessage(null);
      try {
        await savePresetRowsToSheet({
          userName: user,
          rows,
          config: SHARED_PRESET_SHEET_CONFIG,
          ensureHeaderRow: true
        });
        setSaveMessage(t('presetSaveSuccess'));
      } catch (err: any) {
        console.error('Save template builder presets failed:', err);
        setSaveError(err?.message || t('presetSaveError'));
      } finally {
        setIsSaving(false);
      }
    };

    requestSaveConfirmation(executeSave);
  }, [presetUser, state, t]);

  useEffect(() => {
    registerSaveHandler?.(handleSaveTemplatesToSheet);
    return () => registerSaveHandler?.(null);
  }, [registerSaveHandler, handleSaveTemplatesToSheet]);

  useEffect(() => {
    if (!onSaveStatusChange) return;
    if (saveError) {
      onSaveStatusChange({ type: 'error', message: saveError });
    } else if (saveMessage) {
      onSaveStatusChange({ type: 'success', message: saveMessage });
    } else {
      onSaveStatusChange(null);
    }
  }, [saveError, saveMessage, onSaveStatusChange]);

  useEffect(() => {
    setSaveError(null);
    setSaveMessage(null);
    setSyncError(null);
    setSyncMessage(null);
  }, [presetUser]);

  useEffect(() => {
    if (!presetUser) {
      lastSyncedUserRef.current = null;
      return;
    }
    if (!isValidPresetUser(presetUser)) {
      lastSyncedUserRef.current = null;
      return;
    }
    const normalized = presetUser.trim().toLowerCase();
    if (lastSyncedUserRef.current === normalized) {
      return;
    }
    lastSyncedUserRef.current = normalized;
    handleSyncFromSheet();
  }, [presetUser, handleSyncFromSheet]);

  return (
    <div className="tool-container template-builder-page">
      {statusMessage && (
        <div className={`preset-status ${statusClass}`}>
          {statusMessage}
        </div>
      )}
      <TemplateBuilderView state={state} setState={setState} />
      <ConfirmDialog
        open={isSaveConfirmOpen}
        title={t('presetSaveConfirmTitle')}
        description={t('presetSaveConfirmDesc', { user: confirmUserLabel })}
        confirmLabel={t('presetSaveConfirmConfirm')}
        cancelLabel={t('cancel')}
        dontAskLabel={t('presetSaveConfirmDontAsk')}
        dontAskChecked={dontAskAgain}
        onDontAskChange={setDontAskAgain}
        onConfirm={handleConfirmSave}
        onCancel={handleCancelSaveConfirm}
      />
    </div>
  );
};

const TemplateBuilderModal: React.FC<{
  state: TemplateBuilderState;
  setState: React.Dispatch<React.SetStateAction<TemplateBuilderState>>;
  onClose: () => void;
}> = ({ state, setState, onClose }) => (
  <div className="modal-overlay" onMouseDown={onClose}>
    <div className="modal-content template-builder-modal" onMouseDown={e => e.stopPropagation()}>
      <TemplateBuilderView state={state} setState={setState} showHeader={false} onClose={onClose} />
    </div>
  </div>
);

type Point = { x: number; y: number; };
type BrushPath = { points: Point[]; size: number; color: string; };
type Rect = { x: number; y: number; width: number; height: number; color: string; };
type Preset = { id: string; label: string; prompt: string; isCustom?: boolean };

type PortraitCategory = {
  id: string;
  label: string;
  presets: Preset[];
  isDeletable: boolean;
};

type PortraitImage = {
  id: string;
  file: File;
  url: string;
  base64: string;
  history: string[];
  historyIndex: number;
  status: 'pending' | 'queued' | 'processing' | 'success' | 'error';
  error: string | null;
  prompt: string;
  selectedPresetId: string | null;
};

type PortraitState = {
  images: PortraitImage[];
  activeImageId: string | null;
  activeTab: string;
  categories: PortraitCategory[];
  customPrompts: { [categoryId: string]: string }; // Input values for each category's custom field
  nextPresetId: number;
  nextCategoryId: number; // For unique IDs for new categories
  selection: {
    active: boolean;
    rects: Rect[];
    currentColor: string;
  };
  brush: {
    active: boolean;
    size: number;
    color: string;
    paths: BrushPath[];
  };
  renamingCategoryId: string | null;
  isAddingNewCategory: boolean;
  editingPreset: { categoryId: string; presetId: string; } | null;
};

type PresetSaveStatus = {
  type: 'success' | 'error';
  message: string;
};

const cloneCategories = (categories: PortraitCategory[]): PortraitCategory[] =>
  categories.map(cat => ({
    ...cat,
    presets: cat.presets.map(p => ({ ...p }))
  }));

const ensureCustomPromptMap = (
  categories: PortraitCategory[],
  existing: PortraitState['customPrompts']
): PortraitState['customPrompts'] => {
  const next = { ...existing };
  categories.forEach((cat) => {
    if (next[cat.id] === undefined) {
      next[cat.id] = '';
    }
  });
  return next;
};

const SELECTION_COLORS = ['#32CD32', '#00FFFF', '#FF00FF', '#FFFF00', '#FFA500']; // Lime, Cyan, Magenta, Yellow, Orange

const PresetEditModal: React.FC<{ preset: Preset; onSave: (data: { label: string; prompt: string }) => void; onCancel: () => void; t: (key: any) => string; }> = ({ preset, onSave, onCancel, t }) => {
  const [label, setLabel] = useState(preset.label);
  const [prompt, setPrompt] = useState(preset.prompt);

  const handleSave = () => {
    if (label.trim() && prompt.trim()) {
      onSave({ label, prompt });
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-content" onMouseDown={e => e.stopPropagation()}>
        <h3>{t('editPreset')}</h3>
        <div className="form-group">
          <input
            type="text"
            placeholder={t('presetLabelPlaceholder')}
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
        </div>
        <div className="form-group">
          <textarea
            placeholder={t('presetPromptPlaceholder')}
            rows={5}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
        </div>
        <div className="modal-footer">
          <button className="secondary-btn" onClick={onCancel}>{t('cancel')}</button>
          <button className="primary" onClick={handleSave}>{t('save')}</button>
        </div>
      </div>
    </div>
  );
};

// FIX: Explicitly type CategoryTabInput as a React.FC to allow standard component props like `key`.
type CategoryTabInputProps = {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  placeholder: string;
};

const CategoryTabInput: React.FC<CategoryTabInputProps> = ({ initialValue, onCommit, onCancel, placeholder }) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleCommit = () => {
    const trimmedValue = value.trim();
    if (trimmedValue) {
      onCommit(trimmedValue);
    } else {
      onCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCommit();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="category-tab-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleCommit}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
    />
  );
};


const ImageStudioTool: React.FC<{
  state: PortraitState;
  setState: (updater: (prevState: PortraitState) => PortraitState) => void;
  presetUser: string;
  registerSaveHandler?: (handler: (() => void) | null) => void;
  onSaveStatusChange?: (status: PresetSaveStatus | null) => void;
  imageModel: string;
  imageResolution: string;
  onEditInMagicCanvas?: (file: File) => void;
}> = ({ state, setState, presetUser, registerSaveHandler, onSaveStatusChange, imageModel, imageResolution, onEditInMagicCanvas }) => {
  const { t } = useTranslation();
  const { getAiInstance } = useApi();
  const { images, activeImageId, categories, customPrompts, selection, brush, activeTab, renamingCategoryId, isAddingNewCategory, editingPreset } = state;
  const activeImage = images.find(img => img.id === activeImageId) || null;
  const image = activeImage; // Alias for backward compatibility in this component
  const history = activeImage?.history || [];
  const historyIndex = activeImage?.historyIndex ?? -1;
  const error = activeImage?.error || null;
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncingPresets, setIsSyncingPresets] = useState(false);
  const [presetSyncMessage, setPresetSyncMessage] = useState<string | null>(null);
  const [presetSyncError, setPresetSyncError] = useState<string | null>(null);
  const [isSavingPresets, setIsSavingPresets] = useState(false);
  const [presetSaveMessage, setPresetSaveMessage] = useState<string | null>(null);
  const [presetSaveError, setPresetSaveError] = useState<string | null>(null);
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState(false);
  const [skipSaveConfirm, setSkipSaveConfirm] = useState(() => getShouldSkipPresetSaveConfirm());
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const isDrawing = useRef(false);
  const selectionStartPos = useRef({ x: 0, y: 0 });
  const currentRectRef = useRef<Omit<Rect, 'color'> | null>(null);
  const defaultCategoriesRef = useRef<PortraitCategory[]>(cloneCategories(state.categories));
  const hasAutoSyncedRef = useRef(false);
  const pendingSaveActionRef = useRef<(() => void) | null>(null);
  const globalPasteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const presetToEdit = useMemo(() => {
    if (!editingPreset) return null;
    const category = categories.find(c => c.id === editingPreset.categoryId);
    if (!category) return null;
    return category.presets.find(p => p.id === editingPreset.presetId);
  }, [editingPreset, categories]);

  const handleSyncPresetsFromSheet = useCallback(async () => {
    const user = presetUser.trim();
    if (!user) {
      setPresetSyncError(t('presetUserRequired'));
      setPresetSyncMessage(null);
      return;
    }
    if (!isValidPresetUser(user)) {
      setPresetSyncError(t('presetUserMustBeGmail'));
      setPresetSyncMessage(null);
      return;
    }

    setPresetSyncError(null);
    setPresetSyncMessage(null);
    setIsSyncingPresets(true);

    try {
      const rows = await fetchUserPresetsFromSheet(user, SHARED_PRESET_SHEET_CONFIG);
      const sortedRows = [...rows].sort((a, b) => {
        const catOrder = (a.categoryOrder ?? 0) - (b.categoryOrder ?? 0);
        if (catOrder !== 0) return catOrder;
        return (a.presetOrder ?? 0) - (b.presetOrder ?? 0);
      });

      const categoryOrderMap = new Map<string, number>();
      const presetOrderMap = new Map<string, number>();
      sortedRows.forEach(row => {
        const categoryKey = (row.category || '').toLowerCase();
        if (row.categoryOrder !== undefined) categoryOrderMap.set(categoryKey, row.categoryOrder);
        if (row.presetOrder !== undefined && row.presetLabel) {
          const presetKey = `${categoryKey}|${row.presetLabel.toLowerCase()}`;
          presetOrderMap.set(presetKey, row.presetOrder);
        }
      });

      setState(prev => {
        const baseCategories = cloneCategories(defaultCategoriesRef.current);
        let nextCategoryId = prev.nextCategoryId;
        let nextPresetId = Math.max(prev.nextPresetId, 1000);
        const customPromptMap = ensureCustomPromptMap(baseCategories, prev.customPrompts);

        sortedRows.forEach((row, idx) => {
          const categoryLabel = row.category || '自定义';
          const categoryKey = categoryLabel.toLowerCase();
          let category = baseCategories.find(c => c.label.toLowerCase() === categoryKey);
          if (!category) {
            const newId = `sheet-${nextCategoryId++}`;
            category = { id: newId, label: categoryLabel, presets: [], isDeletable: true };
            baseCategories.push(category);
            customPromptMap[newId] = '';
          } else if (customPromptMap[category.id] === undefined) {
            customPromptMap[category.id] = '';
          }

          const presetId = `sheet-${idx + 1}-${Date.now()}`;
          category.presets = [...category.presets, {
            id: presetId,
            label: row.presetLabel,
            prompt: row.prompt,
            isCustom: true
          }];
        });

        baseCategories.sort((a, b) => {
          const aOrder = categoryOrderMap.get(a.label.toLowerCase());
          const bOrder = categoryOrderMap.get(b.label.toLowerCase());
          if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) return aOrder - bOrder;
          if (aOrder !== undefined) return -1;
          if (bOrder !== undefined) return 1;
          return a.label.localeCompare(b.label, 'zh');
        });

        baseCategories.forEach(cat => {
          cat.presets = [...cat.presets].sort((a, b) => {
            const keyA = `${cat.label.toLowerCase()}|${a.label.toLowerCase()}`;
            const keyB = `${cat.label.toLowerCase()}|${b.label.toLowerCase()}`;
            const aOrder = presetOrderMap.get(keyA);
            const bOrder = presetOrderMap.get(keyB);
            if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) return aOrder - bOrder;
            if (aOrder !== undefined) return -1;
            if (bOrder !== undefined) return 1;
            return a.label.localeCompare(b.label, 'zh');
          });
        });

        const activeTabId = baseCategories.some(c => c.id === prev.activeTab)
          ? prev.activeTab
          : (baseCategories[0]?.id || prev.activeTab);

        return {
          ...prev,
          categories: baseCategories,
          customPrompts: customPromptMap,
          nextCategoryId,
          nextPresetId: nextPresetId + sortedRows.length + 1,
          activeTab: activeTabId
        };
      });

      setPresetSyncMessage(
        sortedRows.length === 0
          ? t('presetSheetEmpty')
          : t('presetSyncSuccess', { count: sortedRows.length })
      );
    } catch (err: any) {
      setPresetSyncError(err?.message || 'Sync failed');
    } finally {
      setIsSyncingPresets(false);
    }
  }, [presetUser, setState, t]);

  useEffect(() => {
    if (hasAutoSyncedRef.current || !presetUser) return;
    hasAutoSyncedRef.current = true;
    handleSyncPresetsFromSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetUser, handleSyncPresetsFromSheet]);

  useEffect(() => {
    setPresetSaveMessage(null);
    setPresetSaveError(null);
  }, [presetUser]);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      if (image) return; // Don't paste if an image is already loaded

      const items = event.clipboardData?.items;
      if (!items) return;

      const newFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            newFiles.push(new File([file], `pasted-image-${Date.now()}-${i}.${file.type.split('/')[1]}`, { type: file.type }));
          }
        }
      }

      if (newFiles.length > 0) {
        event.preventDefault();
        await handleImageSelect(newFiles);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [image]); // Rerun when image changes to enable/disable listener logic

  const setCustomPrompt = (key: string, value: string) => {
    setState(prev => ({
      ...prev,
      customPrompts: { ...prev.customPrompts, [key]: value }
    }));
  };

  const getSheetRowsFromCategories = useCallback(() => {
    return categories.flatMap((category, categoryIndex) => {
      return category.presets
        .map((preset, presetIndex) => {
          const label = (preset.label || '').trim();
          const promptText = (preset.prompt || '').trim();
          if (!label || !promptText) return null;
          return {
            category: category.label,
            presetLabel: label,
            prompt: promptText,
            categoryOrder: categoryIndex + 1,
            presetOrder: presetIndex + 1
          };
        })
        .filter((row): row is NonNullable<typeof row> => !!row);
    });
  }, [categories]);

  const requestSaveConfirmation = (action: () => void) => {
    if (skipSaveConfirm) {
      action();
      return;
    }
    pendingSaveActionRef.current = action;
    setDontAskAgain(false);
    setIsSaveConfirmOpen(true);
  };

  const handleConfirmSave = () => {
    setIsSaveConfirmOpen(false);
    if (dontAskAgain && !skipSaveConfirm) {
      setShouldSkipPresetSaveConfirm(true);
      setSkipSaveConfirm(true);
    }
    const action = pendingSaveActionRef.current;
    pendingSaveActionRef.current = null;
    action?.();
  };

  const handleCancelSaveConfirm = () => {
    setIsSaveConfirmOpen(false);
    pendingSaveActionRef.current = null;
    setDontAskAgain(false);
  };

  const handleSavePresetsToSheet = useCallback(() => {
    const user = presetUser.trim();
    if (!user) {
      setPresetSaveError(t('presetUserRequired'));
      setPresetSaveMessage(null);
      return;
    }
    if (!isValidPresetUser(user)) {
      setPresetSaveError(t('presetUserMustBeGmail'));
      setPresetSaveMessage(null);
      return;
    }

    const rows = getSheetRowsFromCategories();
    if (!rows.length) {
      setPresetSaveError(t('presetSaveNoData'));
      setPresetSaveMessage(null);
      return;
    }

    const executeSave = async () => {
      setIsSavingPresets(true);
      setPresetSaveError(null);
      setPresetSaveMessage(null);
      try {
        if (!isValidPresetUser(user)) {
          throw new Error(t('presetUserMustBeGmail'));
        }
        await savePresetRowsToSheet({
          userName: user,
          rows,
          config: SHARED_PRESET_SHEET_CONFIG,
          ensureHeaderRow: true
        });
        setPresetSaveMessage(t('presetSaveSuccess'));
      } catch (err: any) {
        console.error('Save presets failed:', err);
        setPresetSaveError(err?.message || t('presetSaveError'));
      } finally {
        setIsSavingPresets(false);
      }
    };

    requestSaveConfirmation(executeSave);
  }, [presetUser, t, getSheetRowsFromCategories, requestSaveConfirmation]);

  const handleClear = () => {
    setState((prev: PortraitState) => ({
      ...prev,
      images: [],
      activeImageId: null,
      selection: { ...prev.selection, active: false, rects: [] },
      brush: { ...prev.brush, active: false, paths: [] },
    }));
  };

  const handleRemoveImage = (id: string) => {
    setState((prev: PortraitState) => {
      const newImages = prev.images.filter(img => img.id !== id);
      let newActiveId = prev.activeImageId;
      if (id === prev.activeImageId) {
        newActiveId = newImages.length > 0 ? newImages[newImages.length - 1].id : null;
      }
      return {
        ...prev,
        images: newImages,
        activeImageId: newActiveId
      };
    });
  };

  const handleAddPreset = (categoryId: string) => {
    const promptText = state.customPrompts[categoryId];
    if (!promptText || !promptText.trim()) return;

    setState((prev: PortraitState) => {
      const newPreset: Preset = { id: `preset-${prev.nextPresetId}`, label: promptText, prompt: promptText, isCustom: true };
      const categoryIndex = prev.categories.findIndex(c => c.id === categoryId);
      if (categoryIndex === -1) return prev;

      const category = prev.categories[categoryIndex];
      if (category.presets.some((p: Preset) => p.label === promptText)) {
        return prev;
      }

      const newCategories = [...prev.categories];
      newCategories[categoryIndex] = { ...category, presets: [...category.presets, newPreset] };

      const newCustomPrompts = { ...prev.customPrompts, [categoryId]: '' };

      return {
        ...prev,
        categories: newCategories,
        customPrompts: newCustomPrompts,
        nextPresetId: prev.nextPresetId + 1,
      };
    });
  };

  const handleRemovePreset = (categoryId: string, presetIdToRemove: string) => {
    setState((prev: PortraitState) => {
      const categoryIndex = prev.categories.findIndex(c => c.id === categoryId);
      if (categoryIndex === -1) return prev;

      const category = prev.categories[categoryIndex];
      const newCategories = [...prev.categories];
      newCategories[categoryIndex] = {
        ...category,
        presets: category.presets.filter((p: Preset) => p.id !== presetIdToRemove)
      };

      return { ...prev, categories: newCategories };
    });
  };

  const handleSavePreset = (newData: { label: string; prompt: string }) => {
    if (!editingPreset) return;
    setState(prev => {
      const newCategories = prev.categories.map(cat => {
        if (cat.id !== editingPreset.categoryId) return cat;
        return {
          ...cat,
          presets: cat.presets.map(p =>
            p.id !== editingPreset.presetId ? p : { ...p, ...newData }
          )
        };
      });
      return { ...prev, categories: newCategories, editingPreset: null };
    });
  };

  const handleCancelEdit = () => {
    setState(prev => ({ ...prev, editingPreset: null }));
  };

  const handleCommitNewCategory = (newCategoryName: string) => {
    setState((prev) => {
      const newId = `custom-${prev.nextCategoryId}`;
      const newCategory: PortraitCategory = {
        id: newId,
        label: newCategoryName,
        presets: [],
        isDeletable: true,
      };
      return {
        ...prev,
        categories: [...prev.categories, newCategory],
        customPrompts: { ...prev.customPrompts, [newId]: '' },
        nextCategoryId: prev.nextCategoryId + 1,
        activeTab: newId,
        isAddingNewCategory: false,
      };
    });
  };

  const handleDeleteCategory = (categoryId: string) => {
    setState(prev => {
      const newCategories = prev.categories.filter(c => c.id !== categoryId);
      const newCustomPrompts = { ...prev.customPrompts };
      delete newCustomPrompts[categoryId];

      let newActiveTab = prev.activeTab;
      if (prev.activeTab === categoryId) {
        newActiveTab = newCategories.length > 0 ? newCategories[0].id : 'general';
      }

      return { ...prev, categories: newCategories, customPrompts: newCustomPrompts, activeTab: newActiveTab };
    });
  };

  const handleCommitRename = (categoryId: string, newName: string) => {
    setState(prev => {
      const newCategories = prev.categories.map(c =>
        c.id === categoryId ? { ...c, label: newName } : c
      );
      return { ...prev, categories: newCategories, renamingCategoryId: null };
    });
  };

  const handleExportPresets = () => {
    const dataToExport = {
      categories: state.categories.map(({ id, ...rest }) => rest) // Export without IDs
    };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(dataToExport, null, 2)
    )}`;
    const link = document.createElement("a");
    link.href = jsonString;
    link.download = "image-studio-presets.json";
    link.click();
  };

  const handleImportPresets = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const importedData = JSON.parse(text);

        if (!importedData.categories || !Array.isArray(importedData.categories)) {
          throw new Error("Invalid preset file format.");
        }

        setState(prev => {
          let newCategories = [...prev.categories];
          let nextPresetId = prev.nextPresetId;
          let nextCategoryId = prev.nextCategoryId;
          const newCustomPrompts = { ...prev.customPrompts };

          importedData.categories.forEach((importedCat: Omit<PortraitCategory, 'id'>) => {
            const existingCat = newCategories.find(c => c.label === importedCat.label);

            if (existingCat) { // Merge presets into existing category
              importedCat.presets.forEach(importedPreset => {
                const presetExists = existingCat.presets.some(p => p.label === importedPreset.label);
                if (!presetExists) {
                  existingCat.presets.push({ ...importedPreset, id: `preset-${nextPresetId++}`, isCustom: true });
                }
              });
            } else { // Add as a new category
              const newCatId = `custom-${nextCategoryId++}`;
              newCategories.push({
                ...importedCat,
                id: newCatId,
                isDeletable: true,
                presets: importedCat.presets.map(p => ({ ...p, id: `preset-${nextPresetId++}`, isCustom: true }))
              });
              newCustomPrompts[newCatId] = '';
            }
          });

          return { ...prev, categories: newCategories, nextPresetId, nextCategoryId, customPrompts: newCustomPrompts };
        });

      } catch (error) {
        console.error("Failed to import presets:", error);
        alert("Error: Could not import presets. File may be invalid.");
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  };

  const handleImageSelect = async (files: File[] | File) => {
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) return;

    const newImages: PortraitImage[] = [];

    for (const file of fileList) {
      const base64 = await fileToBase64(file);
      const fullBase64 = `data:${file.type};base64,${base64}`;
      const id = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      newImages.push({
        id,
        file,
        url: fullBase64,
        base64,
        history: [fullBase64],
        historyIndex: 0,
        status: 'pending',
        error: null,
        prompt: '',
        selectedPresetId: null
      });
    }

    setState((prev) => ({
      ...prev,
      images: [...prev.images, ...newImages],
      activeImageId: prev.activeImageId || newImages[0].id, // Select first new image if none selected
      error: null
    }));
  };

  const getSelectionImage = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!image || (selection.rects.length === 0 && brush.paths.length === 0)) {
        reject("No image or selections");
        return;
      }

      const offscreenCanvas = document.createElement('canvas');
      const ctx = offscreenCanvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        offscreenCanvas.width = img.naturalWidth;
        offscreenCanvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);

        selection.rects.forEach(rect => {
          const { x, y, width, height, color } = rect;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(5, img.naturalWidth / 200);
          ctx.strokeRect(x, y, width, height);
        });

        brush.paths.forEach(path => {
          if (path.points.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(path.points[0].x, path.points[0].y);
          for (let i = 1; i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
          }
          ctx.strokeStyle = path.color;
          ctx.lineWidth = path.size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        });

        resolve(offscreenCanvas.toDataURL());
      };
      img.onerror = reject;
      img.src = activeImage.history[activeImage.historyIndex]; // Use current image from history
    });
  };

  const updateActiveImage = (updater: (img: PortraitImage) => Partial<PortraitImage>) => {
    if (!activeImageId) return;
    updateImage(activeImageId, updater);
  };

  const updateImage = (id: string, updater: (img: PortraitImage) => Partial<PortraitImage>) => {
    setState(prev => ({
      ...prev,
      images: prev.images.map(img => img.id === id ? { ...img, ...updater(img) } : img)
    }));
  };

  const handleBatchEdit = async (prompt: string) => {
    // If prompt is provided, it's a global override (or from "Apply to all").
    // If not, we rely on each image's individual prompt.

    const imagesToProcess = images.filter(img => img.status !== 'processing');
    if (imagesToProcess.length === 0) return;

    // Set status to queued for all target images that have a valid prompt to run
    setState(prev => ({
      ...prev,
      images: prev.images.map(img => {
        const targetImg = imagesToProcess.find(i => i.id === img.id);
        if (targetImg) {
          const promptToUse = prompt || targetImg.prompt;
          if (promptToUse && promptToUse.trim()) {
            return { ...img, status: 'queued', error: null };
          }
        }
        return img;
      })
    }));

    // Process sequentially
    for (const img of imagesToProcess) {
      // Use the provided prompt (from "Apply to all") or the image's own prompt
      const promptToUse = prompt || img.prompt;
      if (promptToUse && promptToUse.trim()) {
        // Update status to processing for the current image
        updateImage(img.id, () => ({ status: 'processing' }));
        await processImage(img, promptToUse);
      }
    }
  };

  const processImage = async (img: PortraitImage, prompt: string) => {
    const historyIndex = img.historyIndex;
    const history = img.history;
    let imageSrcForApi = history[historyIndex];
    let finalPrompt = prompt;

    // Skip complex selection logic for batch mode for now, or handle if needed
    // Assuming batch mode applies to whole image
    if (activeTab === 'matting' && prompt === 'mattingOption3') {
      updateImage(img.id, () => ({ error: "Batch processing not supported for this option", status: 'error' }));
      return;
    } else {
      finalPrompt = `Please keep the main person in the image and modify the image according to the following instructions: ${prompt}`;
    }

    const mimeTypeMatch = imageSrcForApi.match(/data:(.*);base64,/);
    if (!mimeTypeMatch || mimeTypeMatch.length < 2) {
      updateImage(img.id, () => ({ error: t('error_invalidImageFormat'), status: 'error' }));
      return;
    }
    const mimeType = mimeTypeMatch[1];
    const base64Data = imageSrcForApi.split(',')[1];

    try {
      const ai = getAiInstance();
      const response = await ai.models.generateContent({
        model: imageModel,
        contents: { parts: [{ inlineData: { mimeType, data: base64Data } }, { text: finalPrompt }] },
        config: { responseModalities: [Modality.IMAGE], imageSize: imageResolution } as any,
      });

      const imageResponsePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      if (imageResponsePart?.inlineData) {
        const newImageSrc = `data:${imageResponsePart.inlineData.mimeType};base64,${imageResponsePart.inlineData.data}`;
        const newHistory = history.slice(0, historyIndex + 1);

        updateImage(img.id, () => ({
          history: [...newHistory, newImageSrc],
          historyIndex: newHistory.length,
          status: 'success'
        }));
      } else {
        updateImage(img.id, () => ({ error: t('error_imageGenFailed'), status: 'error' }));
      }
    } catch (e: any) {
      let errorMessage = t('error_imageEditFailed');
      if (e?.message && /safety/i.test(e.message)) {
        errorMessage = t('error_safetyPolicy');
      } else if (e?.message.includes('API key is not set')) {
        errorMessage = t('error_apiKeyNotSet');
      }
      updateImage(img.id, () => ({ error: errorMessage, status: 'error' }));
    }
  };

  const handleSingleEdit = async (prompt: string) => {
    if (isBatchMode) {
      // If batch mode is on, we apply this prompt to ALL images
      // First, update all images to have this prompt
      setState(prev => ({
        ...prev,
        images: prev.images.map(img => ({ ...img, prompt: prompt }))
      }));
      await handleBatchEdit(prompt);
      return;
    }

    // If not batch mode, just update the current image's prompt and process it
    if (activeImageId) {
      updateImage(activeImageId, () => ({ prompt: prompt }));
    }

    if (!activeImage || !history || history.length === 0 || historyIndex < 0) return;
    if (!prompt || !prompt.trim()) {
      updateActiveImage(() => ({ error: t('error_invalidPrompt') }));
      return;
    }
    setIsLoading(true);
    updateActiveImage(() => ({ error: null, status: 'processing' }));

    let finalPrompt = prompt;
    let imageSrcForApi = history[historyIndex];

    // Special handling for matting with selection
    if (activeTab === 'matting' && prompt === 'mattingOption3') {
      finalPrompt = t('mattingOption3');
    }

    const hasSelections = selection.rects.length > 0 || brush.paths.length > 0;

    if (hasSelections) {
      try {
        imageSrcForApi = await getSelectionImage();
        if (activeTab === 'matting' && prompt === t('mattingOption3')) {
          finalPrompt = "The image has colored boxes or brush strokes drawn on it. Remove the object(s) inside these marked areas and fill the area(s) with a realistic background that matches the surroundings."
        } else {
          finalPrompt = `The image contains colored boxes or brush strokes marking selections. Apply the following instruction ONLY to the areas inside these markings: ${prompt}. Keep everything else outside the marked areas unchanged.`;
        }
      } catch (e) {
        console.error("Failed to create selection image", e);
        updateActiveImage(() => ({ error: "Failed to process selection.", status: 'error' }));
        setIsLoading(false);
        return;
      }
    } else if (prompt === t('mattingOption3')) {
      updateActiveImage(() => ({ error: 'Please select an area to remove first.', status: 'error' }));
      setIsLoading(false);
      return;
    } else {
      finalPrompt = `Please keep the main person in the image and modify the image according to the following instructions: ${prompt}`;
    }


    const mimeTypeMatch = imageSrcForApi.match(/data:(.*);base64,/);
    if (!mimeTypeMatch || mimeTypeMatch.length < 2) {
      updateActiveImage(() => ({ error: t('error_invalidImageFormat'), status: 'error' }));
      setIsLoading(false);
      return;
    }
    const mimeType = mimeTypeMatch[1];
    const base64Data = imageSrcForApi.split(',')[1];

    try {
      const ai = getAiInstance();
      console.log(`🎨 [Image Studio] Using AI model: ${imageModel}, resolution: ${imageResolution}`);
      const response = await ai.models.generateContent({
        model: imageModel,
        contents: { parts: [{ inlineData: { mimeType, data: base64Data } }, { text: finalPrompt }] },
        config: { responseModalities: [Modality.IMAGE], imageSize: imageResolution } as any,
      });

      const imageResponsePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      if (imageResponsePart?.inlineData) {
        const newImageSrc = `data:${imageResponsePart.inlineData.mimeType};base64,${imageResponsePart.inlineData.data}`;
        const newHistory = history.slice(0, historyIndex + 1);

        updateActiveImage(() => ({
          history: [...newHistory, newImageSrc],
          historyIndex: newHistory.length,
          status: 'success'
        }));

        // Clear selection globally as it's applied
        setState(prev => ({
          ...prev,
          selection: { ...prev.selection, active: false, rects: [] },
          brush: { ...prev.brush, active: false, paths: [] }
        }));

      } else {
        updateActiveImage(() => ({ error: t('error_imageGenFailed'), status: 'error' }));
      }
    } catch (e: any) {
      let errorMessage = t('error_imageEditFailed');
      if (e?.message && /safety/i.test(e.message)) {
        errorMessage = t('error_safetyPolicy');
      } else if (e?.message.includes('API key is not set')) {
        errorMessage = t('error_apiKeyNotSet');
      }
      updateActiveImage(() => ({ error: errorMessage, status: 'error' }));
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      updateActiveImage(img => ({ historyIndex: img.historyIndex - 1 }));
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      updateActiveImage(img => ({ historyIndex: img.historyIndex + 1 }));
    }
  };

  const handleDownload = () => {
    if (image && historyIndex > 0) {
      downloadDataUrl(history[historyIndex], image.file.name, 'retouched');
    }
  };

  // Selection Drawing Logic
  const drawSelections = () => {
    const canvas = selectionCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const imgEl = imageContainerRef.current?.querySelector('.comparison-image.original') as HTMLImageElement;
    if (!imgEl || imgEl.naturalWidth === 0) return;
    const scaleX = canvas.width / imgEl.naturalWidth;
    const scaleY = canvas.height / imgEl.naturalHeight;

    selection.rects.forEach(rect => {
      const { x, y, width, height, color } = rect;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);
    });

    brush.paths.forEach(path => {
      if (path.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(path.points[0].x * scaleX, path.points[0].y * scaleY);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x * scaleX, path.points[i].y * scaleY);
      }
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.size * scaleX; // Scale brush size too
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    });

    if (currentRectRef.current) {
      const { x, y, width, height } = currentRectRef.current;
      ctx.strokeStyle = selection.currentColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
    }
  };


  const getMousePosOnImage = (e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = selectionCanvasRef.current;
    const container = imageContainerRef.current;
    if (!canvas || !container) return null;

    const imgEl = container.querySelector('.comparison-image.original') as HTMLImageElement;
    if (!imgEl) return null;

    const imgRect = imgEl.getBoundingClientRect();

    const x = e.clientX - imgRect.left;
    const y = e.clientY - imgRect.top;

    const clampedX = Math.max(0, Math.min(x, imgRect.width));
    const clampedY = Math.max(0, Math.min(y, imgRect.height));

    return { x: clampedX, y: clampedY };
  };


  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selection.active && !brush.active) return;

    const pos = getMousePosOnImage(e);
    if (!pos) return;
    isDrawing.current = true;

    if (selection.active) {
      selectionStartPos.current = pos;
      currentRectRef.current = null;
    } else if (brush.active) {
      const imgEl = imageContainerRef.current?.querySelector('.comparison-image.original') as HTMLImageElement;
      if (!imgEl) return;
      const scaleX = imgEl.naturalWidth / imgEl.offsetWidth;
      const scaleY = imgEl.naturalHeight / imgEl.offsetHeight;
      const newPath: BrushPath = {
        points: [{ x: pos.x * scaleX, y: pos.y * scaleY }],
        size: brush.size,
        color: brush.color,
      };
      setState(p => ({ ...p, brush: { ...p.brush, paths: [...p.brush.paths, newPath] } }))
    }
  };

  useEffect(() => {
    const isSelectionMode = selection.active || brush.active;
    if (!isSelectionMode) {
      isDrawing.current = false;
      currentRectRef.current = null;
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawing.current) return;
      const pos = getMousePosOnImage(e);
      if (!pos) return;

      if (selection.active) {
        const x = Math.min(selectionStartPos.current.x, pos.x);
        const y = Math.min(selectionStartPos.current.y, pos.y);
        const width = Math.abs(selectionStartPos.current.x - pos.x);
        const height = Math.abs(selectionStartPos.current.y - pos.y);
        currentRectRef.current = { x, y, width, height };
        drawSelections();
      } else if (brush.active) {
        const imgEl = imageContainerRef.current?.querySelector('.comparison-image.original') as HTMLImageElement;
        if (!imgEl) return;
        const scaleX = imgEl.naturalWidth / imgEl.offsetWidth;
        const scaleY = imgEl.naturalHeight / imgEl.offsetHeight;
        const newPoint = { x: pos.x * scaleX, y: pos.y * scaleY };
        setState(p => {
          const newPaths = [...p.brush.paths];
          if (newPaths.length > 0) {
            newPaths[newPaths.length - 1].points.push(newPoint);
          }
          return { ...p, brush: { ...p.brush, paths: newPaths } };
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;

      if (selection.active && currentRectRef.current) {
        const { width, height } = currentRectRef.current;
        const imgEl = imageContainerRef.current?.querySelector('.comparison-image.original') as HTMLImageElement;
        if (imgEl && width > 5 && height > 5) {
          const scaleX = imgEl.naturalWidth / imgEl.offsetWidth;
          const scaleY = imgEl.naturalHeight / imgEl.offsetHeight;
          const newRect: Rect = {
            x: currentRectRef.current.x * scaleX,
            y: currentRectRef.current.y * scaleY,
            width: width * scaleX,
            height: height * scaleY,
            color: selection.currentColor,
          };
          setState(prev => ({ ...prev, selection: { ...prev.selection, rects: [...prev.selection.rects, newRect] } }));
        }
        currentRectRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selection.active, selection.rects, selection.currentColor, brush.active, brush.paths]);

  useEffect(() => {
    const canvas = selectionCanvasRef.current;
    const container = imageContainerRef.current;
    if (!canvas || !container) return;

    const imgEl = container.querySelector('.comparison-image.original') as HTMLImageElement;
    if (!imgEl) return;

    const syncCanvasToImage = () => {
      if (!imgEl || !container) return;
      const imgRect = imgEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      canvas.style.position = 'absolute';
      canvas.style.top = `${imgRect.top - containerRect.top}px`;
      canvas.style.left = `${imgRect.left - containerRect.left}px`;
      canvas.style.width = `${imgRect.width}px`;
      canvas.style.height = `${imgRect.height}px`;

      canvas.width = imgRect.width;
      canvas.height = imgRect.height;

      drawSelections();
    };

    const resizeObserver = new ResizeObserver(syncCanvasToImage);

    resizeObserver.observe(imgEl);
    resizeObserver.observe(container);

    imgEl.addEventListener('load', syncCanvasToImage);

    if (imgEl.complete) {
      syncCanvasToImage();
    }

    return () => {
      resizeObserver.disconnect();
      imgEl.removeEventListener('load', syncCanvasToImage);
    };
  }, [selection.rects, brush.paths, selection.active, brush.active, image]);

  const statusMessage = presetSaveError || presetSyncError || presetSaveMessage || presetSyncMessage;
  const statusType = (presetSaveError || presetSyncError) ? 'error' : 'success';
  const confirmUserLabel = presetUser.trim() || t('presetUserPlaceholder');
  const saveConfirmDescription = t('presetSaveConfirmDesc', { user: confirmUserLabel });

  useEffect(() => {
    registerSaveHandler?.(handleSavePresetsToSheet);
    return () => registerSaveHandler?.(null);
  }, [registerSaveHandler, handleSavePresetsToSheet]);

  useEffect(() => {
    if (!onSaveStatusChange) return;
    if (presetSaveError) {
      onSaveStatusChange({ type: 'error', message: presetSaveError });
    } else if (presetSaveMessage) {
      onSaveStatusChange({ type: 'success', message: presetSaveMessage });
    } else {
      onSaveStatusChange(null);
    }
  }, [presetSaveError, presetSaveMessage, onSaveStatusChange]);
  const activeCategory = categories.find(c => c.id === activeTab);

  return (
    <div
      className="tool-container portrait-tool"
      tabIndex={-1}
      onClick={(e) => {
        // 点击任意非输入区域时，聚焦隐藏的 textarea 以接收粘贴事件
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          globalPasteTextareaRef.current?.focus();
        }
      }}
    >
      {/* 全局隐藏的 textarea，用于接收粘贴事件 */}
      <textarea
        ref={globalPasteTextareaRef}
        style={{ position: 'absolute', left: '-9999px', top: 0, width: '1px', height: '1px', opacity: 0 }}
        aria-hidden="true"
      />
      {editingPreset && presetToEdit && (
        <PresetEditModal
          preset={presetToEdit}
          onSave={handleSavePreset}
          onCancel={handleCancelEdit}
          t={t}
        />
      )}
      <ConfirmDialog
        open={isSaveConfirmOpen}
        title={t('presetSaveConfirmTitle')}
        description={saveConfirmDescription}
        confirmLabel={t('presetSaveConfirmConfirm')}
        cancelLabel={t('cancel')}
        dontAskLabel={t('presetSaveConfirmDontAsk')}
        dontAskChecked={dontAskAgain}
        onDontAskChange={setDontAskAgain}
        onConfirm={handleConfirmSave}
        onCancel={handleCancelSaveConfirm}
      />
      <ToolHeader
        title={t('studioTitle')}
        description={t('studioDescription')}
        onReset={image ? handleClear : undefined}
      />
      {statusMessage && (
        <div className={`preset-status ${statusType}`}>
          {statusMessage}
        </div>
      )}
      {images.length === 0 ? (
        <FileUploader onFileSelect={(file) => handleImageSelect(file as File)} multiple={true}>
          <div className="uploader-content">
            <Image size={24} />
            <p>{t('uploadSingleImage')}</p>
            <div className="upload-buttons">
              <button type="button" className="secondary-btn" onClick={(e) => {
                e.stopPropagation();
                (e.currentTarget.closest('label')?.querySelector('input[type="file"]') as HTMLInputElement)?.click();
              }}>{t('uploadFromComputer')}</button>
            </div>
          </div>
        </FileUploader>
      ) : (
        <div className="portrait-edit-layout">
          <div className="image-list-sidebar">
            <div className="sidebar-header">
              <h4>{t('imageListTitle') || 'Images'} ({images.length})</h4>
              <button className="add-image-btn" onClick={() => importFileRef.current?.click()}>+</button>
              <input
                type="file"
                ref={importFileRef}
                style={{ display: 'none' }}
                multiple
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleImageSelect(Array.from(e.target.files));
                  }
                  e.target.value = '';
                }}
              />
            </div>
            <div className="image-list">
              {images.map((img) => (
                <div
                  key={img.id}
                  className={`image-list-item ${img.id === activeImageId ? 'active' : ''} status-${img.status}`}
                  onClick={() => setState(prev => ({ ...prev, activeImageId: img.id }))}
                >
                  <img src={img.url} alt="thumbnail" />
                  {img.status === 'queued' && <div className="status-indicator queued"><Clock size={14} /> {t('statusQueued')}</div>}
                  {img.status === 'processing' && <div className="status-indicator processing"><Loader2 size={14} className="animate-spin" /> {t('statusProcessing')}</div>}
                  {img.status === 'success' && <div className="status-indicator success"><Check size={14} /> {t('statusSuccess')}</div>}
                  {img.status === 'error' && <div className="status-indicator error"><X size={14} /> {t('statusError')}</div>}
                  <button
                    className="remove-item-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveImage(img.id);
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <div className="sidebar-actions">
              <button className="secondary-btn" onClick={handleClear}>{t('clearHistory')}</button>
            </div>
          </div>

          <div className="portrait-workspace">
            <div className="portrait-previews">
              {activeImage ? (
                <div className="comparison-container">
                  <div className="comparison-header">
                    <h3>{t('originalImage')} / {t('processedImage')}</h3>
                    <div className="preview-actions">
                      <button className={`secondary-btn ${selection.active ? 'active' : ''}`} onClick={() => setState(p => ({ ...p, selection: { ...p.selection, rects: p.selection.active ? p.selection.rects : [], active: !p.selection.active }, brush: { ...p.brush, active: false } }))}>{t('selectArea')}</button>
                      <button className={`secondary-btn ${brush.active ? 'active' : ''}`} onClick={() => setState(p => ({ ...p, brush: { ...p.brush, paths: p.brush.active ? p.brush.paths : [], active: !p.brush.active }, selection: { ...p.selection, active: false } }))}>{t('brush')}</button>
                      {(selection.active || brush.active) && <button className="secondary-btn" onClick={() => setState(p => ({ ...p, selection: { ...p.selection, rects: [] }, brush: { ...p.brush, paths: [] } }))}>{t('clearSelection')}</button>}
                      <button className="secondary-btn" onClick={handleDownload} disabled={isLoading || historyIndex <= 0}>{t('download')}</button>
                      {onEditInMagicCanvas && (
                        <button
                          className="secondary-btn"
                          onClick={() => {
                            if (activeImage && activeImage.url) {
                              fetch(activeImage.url)
                                .then(res => res.blob())
                                .then(blob => {
                                  const file = new File([blob], `edit-${Date.now()}.png`, { type: blob.type });
                                  onEditInMagicCanvas(file);
                                });
                            }
                          }}
                          disabled={isLoading}
                          title={t('editInMagicCanvas') || 'Edit in Magic Canvas'}
                        >
                          <Palette size={14} className="inline mr-1" /> {t('editInMagicCanvas') || 'Edit in Magic Canvas'}
                        </button>
                      )}
                      <div className="history-controls">
                        <button onClick={handleUndo} disabled={isLoading || historyIndex <= 0}>{t('undo')}</button>
                        <button onClick={handleRedo} disabled={isLoading || historyIndex >= history.length - 1}>{t('redo')}</button>
                      </div>
                    </div>
                  </div>
                  {(selection.active || brush.active) && (
                    <div className="selection-controls">
                      <div className="color-palette">
                        {SELECTION_COLORS.map(color => (
                          <button
                            key={color}
                            className={`color-swatch ${selection.active ? (selection.currentColor === color ? 'active' : '') : (brush.color === color ? 'active' : '')}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setState(p => ({ ...p, selection: { ...p.selection, currentColor: color }, brush: { ...p.brush, color: color } }))}
                            aria-label={`Select color ${color}`}
                          />
                        ))}
                      </div>
                      {brush.active && (
                        <div className="brush-size-control">
                          <label htmlFor="brush-size">{t('brushSize')}:</label>
                          <input type="range" id="brush-size" min="2" max="50" value={brush.size} onChange={e => setState(p => ({ ...p, brush: { ...p.brush, size: parseInt(e.target.value, 10) } }))} />
                          <span>{brush.size}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className={`image-display-area ${(selection.active || brush.active) ? 'selection-active' : ''}`} ref={imageContainerRef}>
                    {isLoading && <div className="loader-overlay"><Loader /></div>}
                    <ImageComparisonSlider
                      originalSrc={image.url}
                      processedSrc={history[historyIndex]}
                    />
                    <canvas
                      ref={selectionCanvasRef}
                      className="selection-canvas-overlay"
                      onMouseDown={handleCanvasMouseDown}
                    />
                  </div>
                </div>
              ) : (
                <div className="no-image-selected">
                  <p>{t('selectImageToEdit') || 'Select an image to edit'}</p>
                </div>
              )}
              <div className="info-message">
                <span>ⓘ</span>
                <p>{t('info_resolution_warning')}</p>
              </div>
            </div>

            <div className="portrait-controls">
              <div className="portrait-tabs-nav">
                <div className="batch-mode-toggle">
                  <label>
                    <input
                      type="checkbox"
                      checked={isBatchMode}
                      onChange={(e) => setIsBatchMode(e.target.checked)}
                    />
                    {t('applyToAllImages')}
                  </label>
                </div>
                <button
                  className="secondary-btn"
                  style={{ marginLeft: 'auto', marginRight: '1rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                  onClick={() => handleBatchEdit('')}
                  disabled={isLoading || images.length === 0}
                  title="Process all images with their current prompts"
                >
                  ▶ {t('startBatch')}
                </button>
                {categories.map(cat => {
                  if (cat.id === renamingCategoryId) {
                    return (
                      <CategoryTabInput
                        key={cat.id}
                        initialValue={cat.label}
                        onCommit={(newName) => handleCommitRename(cat.id, newName)}
                        onCancel={() => setState(prev => ({ ...prev, renamingCategoryId: null }))}
                        placeholder={t('categoryInputPlaceholder')}
                      />
                    );
                  }
                  let tabLabel;
                  switch (cat.id) {
                    case 'general': tabLabel = t('tabGeneral'); break;
                    case 'matting': tabLabel = t('tabMatting'); break;
                    case 'outfit': tabLabel = t('tabOutfit'); break;
                    case 'portrait_retouch': tabLabel = t('tabPortrait'); break;
                    case 'background': tabLabel = t('tabBackground'); break;
                    case 'filter': tabLabel = t('tabFilter'); break;
                    default: tabLabel = cat.label;
                  }

                  return (
                    <button
                      key={cat.id}
                      onClick={() => setState(prev => ({ ...prev, activeTab: cat.id }))}
                      className={`portrait-tab-btn ${activeTab === cat.id ? 'active' : ''}`}
                    >
                      <span>{tabLabel}</span>
                      {cat.isDeletable && (
                        <div className="tab-actions">
                          <button className="rename-tab-btn" onClick={(e) => { e.stopPropagation(); setState(prev => ({ ...prev, renamingCategoryId: cat.id })); }} title={t('renameCategory')}>✏️</button>
                          <button className="delete-tab-btn" onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id); }} title={t('deleteCategory')}>&times;</button>
                        </div>
                      )}
                    </button>
                  );
                })}
                {isAddingNewCategory ? (
                  <CategoryTabInput
                    initialValue=""
                    onCommit={handleCommitNewCategory}
                    onCancel={() => setState(prev => ({ ...prev, isAddingNewCategory: false }))}
                    placeholder={t('categoryInputPlaceholder')}
                  />
                ) : (
                  <button className="add-tab-btn" onClick={() => setState(prev => ({ ...prev, isAddingNewCategory: true }))} title={t('addCategory')}>+</button>
                )}
              </div>
              <div className="portrait-tab-content">
                {activeCategory && activeCategory.id !== 'general' && (
                  <div className="controls-section">
                    <div className="preset-selector-group" style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <select
                        className="preset-select"
                        style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        value={activeCategory.presets.find(p => p.prompt === (activeImage?.prompt || customPrompts[activeCategory.id]))?.id || ''}
                        onChange={(e) => {
                          const selectedId = e.target.value;
                          const selectedPreset = activeCategory.presets.find(p => p.id === selectedId);
                          if (selectedPreset) {
                            const newPrompt = selectedPreset.prompt;
                            if (activeImageId) {
                              updateImage(activeImageId, () => ({ prompt: newPrompt }));
                              if (isBatchMode) {
                                setState(prev => ({
                                  ...prev,
                                  images: prev.images.map(img => ({ ...img, prompt: newPrompt }))
                                }));
                              }
                            }
                            setCustomPrompt(activeCategory.id, newPrompt);
                          }
                        }}
                        disabled={isLoading || !activeImage}
                      >
                        <option value="">{t('selectPreset')}</option>
                        {activeCategory.presets.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {/* Optional: Add Edit/Delete buttons for the selected preset if needed, 
                          but for now keeping it simple as per request. 
                          If the user selects a preset, they can edit the prompt in the input below. 
                          To edit/delete the actual preset entry, we might need a management UI.
                          For now, I'll add small buttons if a preset is selected.
                      */}
                      {activeCategory.presets.find(p => p.prompt === (activeImage?.prompt || customPrompts[activeCategory.id])) && (
                        <>
                          <button
                            className="edit-preset-btn"
                            onClick={() => {
                              const currentPreset = activeCategory.presets.find(p => p.prompt === (activeImage?.prompt || customPrompts[activeCategory.id]));
                              if (currentPreset) setState(prev => ({ ...prev, editingPreset: { categoryId: activeCategory.id, presetId: currentPreset.id } }));
                            }}
                            title={t('editPreset')}
                            style={{ padding: '0.5rem' }}
                          >
                            ✏️
                          </button>
                          <button
                            className="remove-preset-btn"
                            onClick={() => {
                              const currentPreset = activeCategory.presets.find(p => p.prompt === (activeImage?.prompt || customPrompts[activeCategory.id]));
                              if (currentPreset) handleRemovePreset(activeCategory.id, currentPreset.id);
                            }}
                            disabled={isLoading}
                            style={{ padding: '0.5rem', position: 'static', opacity: 1, background: 'transparent', color: 'var(--text-color)', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                          >
                            &times;
                          </button>
                        </>
                      )}
                    </div>
                    <div className="controls-grid" style={{ marginBottom: '1rem' }}>
                      {activeCategory.presets.map((opt) => (
                        <div key={opt.id} className="preset-btn-wrapper">
                          <button onClick={() => {
                            const newPrompt = opt.prompt;
                            if (activeImageId) {
                              updateImage(activeImageId, () => ({ prompt: newPrompt }));
                              if (isBatchMode) {
                                setState(prev => ({
                                  ...prev,
                                  images: prev.images.map(img => ({ ...img, prompt: newPrompt }))
                                }));
                              }
                            }
                            setCustomPrompt(activeCategory.id, newPrompt);
                            handleSingleEdit(newPrompt);
                          }} disabled={isLoading || !activeImage}>{opt.label}</button>
                        </div>
                      ))}
                    </div>
                    <div className="custom-input-group">
                      <input
                        type="text"
                        placeholder={t('customPlaceholder')}
                        value={activeImage?.prompt || customPrompts[activeCategory.id] || ''}
                        onChange={(e) => {
                          const newPrompt = e.target.value;
                          if (activeImageId) {
                            updateImage(activeImageId, () => ({ prompt: newPrompt }));
                            if (isBatchMode) {
                              setState(prev => ({
                                ...prev,
                                images: prev.images.map(img => ({ ...img, prompt: newPrompt }))
                              }));
                            }
                          }
                          setCustomPrompt(activeCategory.id, newPrompt);
                        }}
                        disabled={isLoading}
                      />
                      <button className="add-preset-btn" title={t('addPreset')} onClick={() => handleAddPreset(activeCategory.id)} disabled={isLoading || !(activeImage?.prompt || customPrompts[activeCategory.id] || '').trim()}>+</button>
                      <button onClick={() => handleSingleEdit(activeImage?.prompt || customPrompts[activeCategory.id] || '')} disabled={isLoading || !(activeImage?.prompt || customPrompts[activeCategory.id] || '').trim() || !activeImage}>{t('execute')}</button>
                    </div>
                  </div>
                )}
                {activeCategory && activeCategory.id === 'general' && (
                  <div className="controls-section">
                    <p className="tool-description">{t('generalCustomPrompt')}</p>
                    <div className="custom-input-group">
                      <textarea
                        rows={5}
                        placeholder={t('generalCustomPlaceholder')}
                        value={activeImage?.prompt || customPrompts.general || ''}
                        onChange={(e) => {
                          const newPrompt = e.target.value;
                          if (activeImageId) {
                            updateImage(activeImageId, () => ({ prompt: newPrompt }));
                            if (isBatchMode) {
                              setState(prev => ({
                                ...prev,
                                images: prev.images.map(img => ({ ...img, prompt: newPrompt }))
                              }));
                            }
                          }
                          setCustomPrompt('general', newPrompt);
                        }}
                        disabled={isLoading}
                      />
                    </div>
                    <button className="primary" onClick={() => handleSingleEdit(activeImage?.prompt || customPrompts.general || '')} disabled={isLoading || !(activeImage?.prompt || customPrompts.general || '').trim() || !activeImage}>{t('execute')}</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {error && <p className="error-message">{error}</p>}
    </div>
  );
};

// --- Main App Component ---

const ApiKeyModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { apiKey, setApiKey, usePool, setUsePool, useSharedPool, setUseSharedPool, poolConfig, setPoolConfig, refreshApiPool, rotateApiKey, apiPoolStatus, poolError } = useApi();
  const { user } = useAuth(); // 获取 Firebase 用户
  const [activeTab, setActiveTab] = useState<'manual' | 'pool'>(usePool ? 'pool' : 'manual');
  const [localKey, setLocalKey] = useState(apiKey);

  // 默认使用软件目录的Sheet ID和用户邮箱
  const DEFAULT_SHEET_ID = '1InDrlrypvb_5xwtNCmqYIUuWL5cm7YNbBaCvJuEY9D0';
  // 优先使用 Firebase 用户邮箱，回退到 localStorage
  const [storedUserEmail, setStoredUserEmail] = useState(
    user?.email || localStorage.getItem('app_preset_user') || ''
  );

  const [localPoolConfig, setLocalPoolConfig] = useState({
    sheetId: poolConfig?.sheetId || DEFAULT_SHEET_ID,
    sheetName: poolConfig?.sheetName || 'ApiKeys',
    userName: poolConfig?.userName || storedUserEmail
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [adminAllowed, setAdminAllowed] = useState(false);
  const [adminCheckLoading, setAdminCheckLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // API密钥管理状态
  const [apiKeys, setApiKeys] = useState<Array<{ apiKey: string; status: string; nickname: string }>>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);

  // 添加/编辑密钥弹窗状态
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [editingKey, setEditingKey] = useState<{ apiKey: string; nickname: string } | null>(null);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newNicknameInput, setNewNicknameInput] = useState('');
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ apiKey: string; nickname: string } | null>(null);
  const [batchMode, setBatchMode] = useState(false);  // 批量添加模式
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());  // 批量删除选中的密钥
  const [batchDeleteMode, setBatchDeleteMode] = useState(false);  // 批量删除模式
  const [sheetSyncStatus, setSheetSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');  // 表格同步状态



  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 每次切换标签或组件挂载时重新读取邮箱，优先使用 Firebase 用户
  useEffect(() => {
    const email = user?.email || localStorage.getItem('app_preset_user') || '';
    setStoredUserEmail(email);
  }, [activeTab, user?.email]);

  useEffect(() => {
    let cancelled = false;
    const checkAdminAccess = async () => {
      if (activeTab !== 'pool' || !user?.email) {
        setAdminAllowed(false);
        return;
      }
      setAdminCheckLoading(true);
      try {
        const { adminService } = await import('./services/adminService');
        const admins = await adminService.fetchAdmins({ googleSheetId: DEFAULT_SHEET_ID });
        if (!cancelled) {
          setAdminAllowed(admins.includes(user.email.toLowerCase()));
        }
      } catch (error) {
        console.warn('[ApiKeyModal] 管理员权限校验失败:', error);
        if (!cancelled) {
          setAdminAllowed(false);
        }
      } finally {
        if (!cancelled) {
          setAdminCheckLoading(false);
        }
      }
    };
    checkAdminAccess();
    return () => {
      cancelled = true;
    };
  }, [activeTab, user?.email]);

  useEffect(() => {
    if (!adminAllowed && useSharedPool) {
      setUseSharedPool(false);
    }
  }, [adminAllowed, useSharedPool, setUseSharedPool]);

  // 监听 Google Sheets 同步状态
  useEffect(() => {
    const handleSyncStatus = (e: CustomEvent) => {
      setSheetSyncStatus(e.detail);
    };
    window.addEventListener('sheetSyncStatus', handleSyncStatus as EventListener);
    return () => {
      window.removeEventListener('sheetSyncStatus', handleSyncStatus as EventListener);
    };
  }, []);

  // 加载API密钥列表
  const loadApiKeys = async () => {
    if (!storedUserEmail) {
      console.warn('[loadApiKeys] 没有storedUserEmail，跳过加载');
      return;
    }

    console.log('[loadApiKeys] 开始加载，用户:', storedUserEmail);
    setIsLoadingKeys(true);
    setKeysError(null);
    try {
      const { fetchUserApiKeys } = await import('./services/apiKeyManagementService');
      const keys = await fetchUserApiKeys(storedUserEmail);
      console.log('[loadApiKeys] 获取到密钥:', keys);

      setApiKeys(keys.map(k => ({
        apiKey: k.apiKey,
        status: k.status,
        nickname: k.nickname
      })));

      console.log('[loadApiKeys] setApiKeys完成，数量:', keys.length);
    } catch (error: any) {
      console.error('[loadApiKeys] 错误:', error);
      setKeysError(error.message || '加载API密钥失败');
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // 切换到API池标签时自动加载
  useEffect(() => {
    if (activeTab === 'pool' && storedUserEmail && !useSharedPool) {
      loadApiKeys();
    }
  }, [activeTab, storedUserEmail, useSharedPool]);


  const handleSaveManual = () => {
    setApiKey(localKey);
    setUsePool(false);
    onClose();
  };

  const handleSavePool = async () => {
    if (useSharedPool) {
      if (!user?.email) {
        alert('请先登录账号以启用内部学习模式');
        return;
      }
    } else {
      if (!storedUserEmail) {
        alert('请先在软件目录中设置您的邮箱');
        return;
      }

      // 使用固定的Sheet ID和标签页名称，以及自动读取的邮箱
      setPoolConfig({
        sheetId: DEFAULT_SHEET_ID,
        sheetName: 'ApiKeys',
        userName: storedUserEmail
      });
    }

    setUsePool(true);
    setIsRefreshing(true);
    await refreshApiPool();
    setIsRefreshing(false);

    if (!poolError) {
      onClose();
    }
  };

  // 打开添加API密钥弹窗
  const handleAddApiKey = () => {
    setEditingKey(null);
    setNewKeyInput('');
    setNewNicknameInput('');
    setBatchMode(false);
    setShowAddKeyModal(true);
  };

  // 保存新API密钥（支持批量）
  const handleSaveNewKey = async () => {
    if (!storedUserEmail) {
      setSaveMessage({ type: 'error', text: '请先设置用户邮箱' });
      setTimeout(() => setSaveMessage(null), 3000);
      return;
    }

    if (!newKeyInput.trim()) {
      setSaveMessage({ type: 'error', text: '请输入API密钥' });
      setTimeout(() => setSaveMessage(null), 3000);
      return;
    }

    setIsLoadingKeys(true);
    setSaveMessage(null);

    try {
      if (batchMode) {
        // 批量模式：解析多行输入，一次性保存
        const { fetchUserApiKeys, saveApiKeys } = await import('./services/apiKeyManagementService');
        const existingKeys = await fetchUserApiKeys(storedUserEmail);
        const existingKeySet = new Set(existingKeys.map(k => k.apiKey));

        const lines = newKeyInput.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const newKeys: Array<{ apiKey: string; nickname: string; status: string }> = [];
        let duplicateCount = 0;

        for (const line of lines) {
          // 支持格式: "key" 或 "key 备注" 或 "key,备注"
          const parts = line.split(/[\s,]+/);
          const key = parts[0];
          const nickname = parts.slice(1).join(' ') || '';  // 无默认编号

          if (key && key.length > 10) {
            if (existingKeySet.has(key)) {
              duplicateCount++;
            } else {
              newKeys.push({ apiKey: key, nickname, status: 'active' });
              existingKeySet.add(key);  // 防止批量输入中的重复
            }
          }
        }

        if (newKeys.length > 0) {
          // 合并现有密钥和新密钥，一次性保存
          const allKeys = [
            ...existingKeys.map(k => ({ apiKey: k.apiKey, nickname: k.nickname, status: k.status })),
            ...newKeys
          ];
          await saveApiKeys(storedUserEmail, allKeys);
        }

        await loadApiKeys();
        setShowAddKeyModal(false);
        setNewKeyInput('');
        setBatchMode(false);

        if (duplicateCount > 0) {
          setSaveMessage({ type: 'success', text: `成功添加 ${newKeys.length} 个密钥，${duplicateCount} 个重复已跳过` });
        } else if (newKeys.length > 0) {
          setSaveMessage({ type: 'success', text: `成功批量添加 ${newKeys.length} 个API密钥！` });
        } else {
          setSaveMessage({ type: 'error', text: '没有有效的密钥可添加' });
        }
      } else {
        // 单个模式
        const { addApiKey } = await import('./services/apiKeyManagementService');
        await addApiKey(storedUserEmail, newKeyInput.trim(), newNicknameInput.trim(), 'active');
        await new Promise(resolve => setTimeout(resolve, 500));
        await loadApiKeys();
        setShowAddKeyModal(false);
        setNewKeyInput('');
        setNewNicknameInput('');
        setSaveMessage({ type: 'success', text: 'API密钥添加成功！' });
      }

      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error: any) {
      const errorMsg = error.message || '未知错误';
      if (errorMsg.includes('速率限制') || errorMsg.includes('429')) {
        setSaveMessage({ type: 'error', text: '请求过于频繁，请等待10-30秒后重试' });
      } else {
        setSaveMessage({ type: 'error', text: `添加失败: ${errorMsg}` });
      }
      setTimeout(() => setSaveMessage(null), 4000);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // 编辑API密钥 - 打开编辑弹窗
  const handleEditApiKey = (apiKey: string, currentNickname: string) => {
    setEditingKey({ apiKey, nickname: currentNickname });
    setNewKeyInput(apiKey);
    setNewNicknameInput(currentNickname);
    setShowAddKeyModal(true);
  };

  // 保存编辑的API密钥
  const handleSaveEditedKey = async () => {
    if (!storedUserEmail || !editingKey) return;

    setIsLoadingKeys(true);
    setSaveMessage(null);
    try {
      const { updateApiKey } = await import('./services/apiKeyManagementService');
      await updateApiKey(storedUserEmail, editingKey.apiKey, { nickname: newNicknameInput.trim() });
      await loadApiKeys();
      setShowAddKeyModal(false);
      setEditingKey(null);
      setSaveMessage({ type: 'success', text: '更新成功！' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error: any) {
      setSaveMessage({ type: 'error', text: `更新失败: ${error.message}` });
      setTimeout(() => setSaveMessage(null), 4000);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // 删除API密钥 - 显示确认对话框
  const handleDeleteApiKey = (apiKey: string, nickname: string) => {
    setConfirmDelete({ apiKey, nickname });
  };

  // 确认删除
  const confirmDeleteApiKey = async () => {
    if (!storedUserEmail || !confirmDelete) return;

    setIsLoadingKeys(true);
    setSaveMessage(null);
    try {
      const { deleteApiKey } = await import('./services/apiKeyManagementService');
      await deleteApiKey(storedUserEmail, confirmDelete.apiKey);
      await loadApiKeys();
      setConfirmDelete(null);
      setSaveMessage({ type: 'success', text: '删除成功！' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error: any) {
      setSaveMessage({ type: 'error', text: `删除失败: ${error.message}` });
      setTimeout(() => setSaveMessage(null), 4000);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // 批量删除选中的密钥
  const handleBatchDelete = async () => {
    if (!storedUserEmail || selectedKeys.size === 0) return;

    const deleteCount = selectedKeys.size;
    if (!confirm(`确定要删除选中的 ${deleteCount} 个密钥吗？此操作无法撤销。`)) {
      return;
    }

    setIsLoadingKeys(true);
    setSaveMessage(null);
    try {
      const { saveApiKeys, fetchUserApiKeys } = await import('./services/apiKeyManagementService');
      const allKeys = await fetchUserApiKeys(storedUserEmail);
      const remainingKeys = allKeys.filter(k => !selectedKeys.has(k.apiKey));

      if (remainingKeys.length === 0) {
        // 删除全部：直接清空 Firebase，同时同步到 Google Sheets
        const { saveUserApiPool } = await import('./services/userApiPoolService');
        const { getFirebaseUserId } = await import('./services/apiKeyManagementService');
        const userId = getFirebaseUserId();
        if (userId) {
          await saveUserApiPool(userId, []);
        }
      } else {
        await saveApiKeys(storedUserEmail, remainingKeys.map(k => ({
          apiKey: k.apiKey,
          status: k.status,
          nickname: k.nickname
        })));
      }

      await loadApiKeys();
      setSelectedKeys(new Set());
      setBatchDeleteMode(false);
      setSaveMessage({ type: 'success', text: `成功删除 ${deleteCount} 个密钥！` });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error: any) {
      console.error('[BatchDelete] Error:', error);
      setSaveMessage({ type: 'error', text: `批量删除失败: ${error.message}` });
      setTimeout(() => setSaveMessage(null), 4000);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // 切换单个密钥选中状态
  const toggleKeySelection = (apiKey: string) => {
    setSelectedKeys(prev => {
      const newSet = new Set(prev);
      if (newSet.has(apiKey)) {
        newSet.delete(apiKey);
      } else {
        newSet.add(apiKey);
      }
      return newSet;
    });
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedKeys.size === apiKeys.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(apiKeys.map(k => k.apiKey)));
    }
  };

  // 切换API密钥状态
  const handleToggleStatus = async (key: string, currentStatus: string) => {
    if (!storedUserEmail) return;

    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';

    setIsLoadingKeys(true);
    try {
      const { updateApiKey } = await import('./services/apiKeyManagementService');
      await updateApiKey(storedUserEmail, key, { status: newStatus });
      await loadApiKeys();
    } catch (error: any) {
      alert(`❌ 更新状态失败: ${error.message}`);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const handleRefreshPool = async () => {
    setIsRefreshing(true);

    // 如果没有配置，自动创建默认配置
    if (!useSharedPool && !poolConfig && storedUserEmail) {
      const newConfig = {
        sheetId: DEFAULT_SHEET_ID,
        sheetName: 'ApiKeys',
        userName: storedUserEmail
      };
      setPoolConfig(newConfig);
      setUsePool(true);

      // 等待一小段时间让状态更新（React批量更新）
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    await refreshApiPool();
    setIsRefreshing(false);
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-content api-key-modal" onMouseDown={e => e.stopPropagation()}>
        <h3>{t('apiKeyTitle')}</h3>

        {/* 标签页切换 */}
        <div className="modal-tabs">
          <button
            className={activeTab === 'manual' ? 'tab-active' : ''}
            onClick={() => setActiveTab('manual')}
          >
            <Key size={14} className="inline mr-1" /> 手动输入
          </button>
          <button
            className={activeTab === 'pool' ? 'tab-active' : ''}
            onClick={() => setActiveTab('pool')}
          >
            <RefreshCw size={14} className="inline mr-1" /> API池管理
          </button>
        </div>

        {/* 手动输入标签页 */}
        {activeTab === 'manual' && (
          <div className="tab-content">
            <p className="modal-description">{t('apiKeyPrompt')}</p>
            <div className="form-group">
              <input
                ref={inputRef}
                type="password"
                placeholder={t('apiKeyInputPlaceholder')}
                value={localKey}
                onChange={e => setLocalKey(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSaveManual()}
              />
            </div>
            {/* 获取 API Key 按钮 */}
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <button
                type="button"
                onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')}
                style={{
                  background: 'linear-gradient(135deg, #4285f4 0%, #34a853 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.6rem 1.2rem',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 2px 8px rgba(66, 133, 244, 0.3)',
                  transition: 'transform 0.2s, box-shadow 0.2s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(66, 133, 244, 0.4)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(66, 133, 244, 0.3)'; }}
              >
                🔗 免费获取 API Key
              </button>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted-color)', margin: '0.5rem 0 0 0' }}>
                点击跳转到 Google AI Studio，登录后即可一键创建
              </p>
            </div>
            <div className="modal-footer">
              <button className="secondary-btn" onClick={onClose}>{t('cancel')}</button>
              <button className="primary" onClick={handleSaveManual}>{t('save')}</button>
            </div>
          </div>
        )}

        {/* API池管理标签页 */}
        {activeTab === 'pool' && (
          <div className="tab-content">
            <p className="modal-description">
              管理多个API密钥自动轮换，避免单个密钥配额耗尽
            </p>

            {/* 建议提示 */}
            <div style={{
              padding: '0.6rem 0.8rem',
              marginBottom: '0.75rem',
              backgroundColor: 'rgba(255, 193, 7, 0.1)',
              border: '1px solid rgba(255, 193, 7, 0.3)',
              borderRadius: '6px',
              fontSize: '0.75rem',
              color: 'var(--on-surface-color)',
              lineHeight: 1.5
            }}>
              <Lightbulb size={14} className="inline mr-1 text-amber-400" /><strong>建议：</strong>添加至少 5 个以上的 API Key 进行轮换，否则容易出现配额不足报错
            </div>

            {/* API池开关 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              background: usePool ? '#4caf5015' : 'var(--control-bg-color)',
              border: `1px solid ${usePool ? '#4caf50' : 'var(--border-color)'}`,
              borderRadius: '8px',
              transition: 'all 0.2s ease'
            }}>
              <div>
                <span style={{ fontWeight: 500, color: 'var(--text-color)' }}>
                  {usePool ? '✓ API池已启用' : '○ API池未启用'}
                </span>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>
                  {usePool ? '正在使用自动轮换功能' : '点击开关启用自动轮换'}
                </p>
              </div>
              <label style={{
                position: 'relative',
                display: 'inline-block',
                width: '50px',
                height: '26px',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={usePool}
                  onChange={(e) => {
                    setUsePool(e.target.checked);
                    if (!e.target.checked) {
                      setUseSharedPool(false);
                      // 关闭时清除配置
                      localStorage.removeItem('use_api_pool');
                    }
                  }}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: usePool ? '#4caf50' : '#ccc',
                  transition: '0.3s',
                  borderRadius: '26px'
                }}>
                  <span style={{
                    position: 'absolute',
                    content: '""',
                    height: '20px',
                    width: '20px',
                    left: usePool ? '27px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '0.3s',
                    borderRadius: '50%',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }} />
                </span>
              </label>
            </div>

            {/* 内部学习模式 */}
            {adminAllowed && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                background: useSharedPool ? 'rgba(33, 150, 243, 0.12)' : 'var(--control-bg-color)',
                border: `1px solid ${useSharedPool ? '#2196f3' : 'var(--border-color)'}`,
                borderRadius: '8px',
                transition: 'all 0.2s ease'
              }}>
                <div>
                  <span style={{ fontWeight: 500, color: 'var(--text-color)' }}>
                    {useSharedPool ? '✓ 内部学习模式已启用' : '○ 内部学习模式未启用'}
                  </span>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>
                    登录后可直接使用共享API池，无需填写个人API Key
                  </p>
                </div>
                <label style={{
                  position: 'relative',
                  display: 'inline-block',
                  width: '50px',
                  height: '26px',
                  cursor: 'pointer'
                }}>
                  <input
                    type="checkbox"
                    checked={useSharedPool}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      if (adminCheckLoading) {
                        alert('正在校验权限，请稍后再试');
                        return;
                      }
                      if (checked && !user?.email) {
                        alert('请先登录账号以启用内部学习模式');
                        return;
                      }
                      if (checked && !adminAllowed) {
                        alert('当前账号未授权使用内部学习模式');
                        return;
                      }
                      setUseSharedPool(checked);
                      if (checked) {
                        setUsePool(true);
                        setIsRefreshing(true);
                        await refreshApiPool();
                        setIsRefreshing(false);
                      } else if (usePool) {
                        setIsRefreshing(true);
                        await refreshApiPool();
                        setIsRefreshing(false);
                      }
                    }}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: useSharedPool ? '#2196f3' : '#ccc',
                    transition: '0.3s',
                    borderRadius: '26px'
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: '20px',
                      width: '20px',
                      left: useSharedPool ? '27px' : '3px',
                      bottom: '3px',
                      backgroundColor: 'white',
                      transition: '0.3s',
                      borderRadius: '50%',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }} />
                  </span>
                </label>
              </div>
            )}

            {/* 显示当前邮箱 */}
            {storedUserEmail && !useSharedPool && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--control-bg-color)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <small style={{ color: 'var(--text-muted-color)', fontSize: '0.85rem' }}>当前用户</small>
                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--primary-color)', fontWeight: 500 }}>
                  {storedUserEmail}
                </p>
              </div>
            )}

            {!storedUserEmail && !useSharedPool && (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: '#ff000020', borderRadius: '6px', border: '1px solid #ff6b6b' }}>
                <p style={{ margin: 0, color: '#ff6b6b', fontSize: '0.9rem' }}>
                  ⚠️ 请先在首页设置您的邮箱
                </p>
              </div>
            )}

            {/* API密钥列表 */}
            {!useSharedPool && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ color: 'var(--on-surface-color)', fontWeight: 500, fontSize: '0.95rem' }}>
                      我的API密钥 {apiKeys.length > 0 && `(${apiKeys.length})`}
                    </label>
                    {/* Google Sheets 同步状态指示器 */}
                    {sheetSyncStatus === 'syncing' && (
                      <span style={{ fontSize: '0.75rem', color: '#2196f3', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>🔄</span>
                        同步到表格...
                      </span>
                    )}
                    {sheetSyncStatus === 'done' && (
                      <span style={{ fontSize: '0.75rem', color: '#4caf50' }}>
                        ✓ 已同步表格
                      </span>
                    )}
                    {sheetSyncStatus === 'error' && (
                      <span style={{ fontSize: '0.75rem', color: '#ff6b6b' }}>
                        ✗ 同步失败
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {/* 批量删除模式 */}
                    {apiKeys.length > 1 && (
                      batchDeleteMode ? (
                        <>
                          <button
                            className="secondary-btn"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                            onClick={toggleSelectAll}
                          >
                            {selectedKeys.size === apiKeys.length ? '取消全选' : '全选'}
                          </button>
                          <button
                            className="secondary-btn"
                            style={{
                              padding: '0.3rem 0.6rem',
                              fontSize: '0.8rem',
                              background: selectedKeys.size > 0 ? '#ff6b6b' : undefined,
                              color: selectedKeys.size > 0 ? 'white' : undefined,
                              border: selectedKeys.size > 0 ? 'none' : undefined
                            }}
                            onClick={handleBatchDelete}
                            disabled={selectedKeys.size === 0 || isLoadingKeys}
                          >
                            🗑️ 删除 ({selectedKeys.size})
                          </button>
                          <button
                            className="secondary-btn"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                            onClick={() => {
                              setBatchDeleteMode(false);
                              setSelectedKeys(new Set());
                            }}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          className="secondary-btn"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                          onClick={() => setBatchDeleteMode(true)}
                          disabled={isLoadingKeys}
                        >
                          批量删除
                        </button>
                      )
                    )}
                    <button
                      className="secondary-btn"
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                      onClick={handleAddApiKey}
                      disabled={isLoadingKeys || !storedUserEmail}
                    >
                      + 添加密钥
                    </button>
                  </div>
                </div>

                {/* API密钥列表显示区域 */}
                <div style={{
                  height: '360px',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--control-bg-color)'
                }}>
                  {/* 加载状态 */}
                  {isLoadingKeys && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted-color)' }}>
                      <p style={{ margin: 0, fontSize: '0.9rem' }}>⏳ 加载中...</p>
                    </div>
                  )}

                  {/* 错误状态 */}
                  {keysError && !isLoadingKeys && (
                    <div style={{ padding: '1rem', background: '#fff3cd', margin: '0.5rem', borderRadius: '6px', border: '1px solid #ffc107' }}>
                      <p style={{ margin: '0 0 0.75rem 0', color: '#856404', fontSize: '0.9rem', fontWeight: 500 }}>
                        ⚠️ {keysError}
                      </p>
                      {keysError.includes('ApiKeys') || keysError.includes('表格') ? (
                        <details style={{ fontSize: '0.8rem', color: '#856404' }}>
                          <summary style={{ cursor: 'pointer', marginBottom: '0.5rem', fontWeight: 500 }}>
                            <Lightbulb size={14} className="inline mr-1" /> 如何解决？点击查看设置步骤
                          </summary>
                          <div style={{
                            padding: '0.75rem',
                            background: '#fff',
                            borderRadius: '4px',
                            marginTop: '0.5rem',
                            lineHeight: '1.8'
                          }}>
                            <p style={{ margin: '0 0 0.5rem 0', fontWeight: 500 }}>
                              需要在Google表格中创建"ApiKeys"标签页：
                            </p>
                            <ol style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                              <li>打开Google表格：
                                <button
                                  style={{
                                    marginLeft: '0.5rem',
                                    padding: '2px 8px',
                                    background: '#4285f4',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    fontSize: '0.75rem',
                                    cursor: 'pointer'
                                  }}
                                  onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/edit`, '_blank')}
                                >
                                  打开表格
                                </button>
                              </li>
                              <li>点击表格底部的"+"按钮，创建新标签页</li>
                              <li>将新标签页重命名为 <code style={{ background: '#f0f0f0', padding: '0 4px', borderRadius: '3px' }}>ApiKeys</code></li>
                              <li>在第一行（A1-D1）输入表头：<br />
                                <code style={{ display: 'block', background: '#f0f0f0', padding: '4px 8px', borderRadius: '3px', fontSize: '0.75rem', marginTop: '4px' }}>
                                  A1: user | B1: apiKey | C1: status | D1: nickname
                                </code>
                              </li>
                              <li>保存后，点击下方"🔄 刷新池"按钮</li>
                            </ol>
                          </div>
                        </details>
                      ) : (
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#856404' }}>
                          请检查网络连接或稍后重试
                        </p>
                      )}
                    </div>
                  )}

                  {/* 真实密钥列表 */}
                  {!isLoadingKeys && apiKeys.length > 0 && apiKeys.map((key, index) => (
                    <div
                      key={index}
                      style={{
                        padding: '0.75rem',
                        borderBottom: index < apiKeys.length - 1 ? '1px solid var(--border-color)' : 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        opacity: key.status === 'disabled' ? 0.5 : 1,
                        background: selectedKeys.has(key.apiKey) ? '#e3f2fd' : 'transparent'
                      }}
                    >
                      {/* 批量删除复选框 */}
                      {batchDeleteMode && (
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key.apiKey)}
                          onChange={() => toggleKeySelection(key.apiKey)}
                          style={{ width: '18px', height: '18px', marginRight: '0.75rem', cursor: 'pointer' }}
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.9rem', fontFamily: 'monospace', color: 'var(--text-color)' }}>
                            {key.apiKey.substring(0, 10)}...{key.apiKey.slice(-4)}
                          </span>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.2rem 0.5rem',
                              background: key.status === 'active' ? '#4caf5020' : '#ff980020',
                              color: key.status === 'active' ? '#4caf50' : '#ff9800',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                            onClick={() => handleToggleStatus(key.apiKey, key.status)}
                            title="点击切换状态"
                          >
                            {key.status === 'active' ? '✓ 激活' : '✗ 禁用'}
                          </span>
                        </div>
                        {key.nickname && (
                          <small style={{ color: 'var(--text-muted-color)', fontSize: '0.8rem' }}>
                            备注: {key.nickname}
                          </small>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.8rem',
                            background: 'transparent',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            color: 'var(--text-muted-color)',
                            cursor: 'pointer'
                          }}
                          onClick={() => handleEditApiKey(key.apiKey, key.nickname)}
                          disabled={isLoadingKeys}
                        >
                          编辑
                        </button>
                        <button
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.8rem',
                            background: 'transparent',
                            border: '1px solid #ff6b6b',
                            borderRadius: '4px',
                            color: '#ff6b6b',
                            cursor: 'pointer'
                          }}
                          onClick={() => handleDeleteApiKey(key.apiKey, key.nickname)}
                          disabled={isLoadingKeys}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* 空状态 */}
                  {!isLoadingKeys && !keysError && apiKeys.length === 0 && (
                    <div style={{
                      padding: '1.5rem',
                      textAlign: 'center',
                      color: 'var(--text-muted-color)'
                    }}>
                      <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-color)' }}>
                        <ClipboardList size={14} className="inline mr-1" /> 还没有API密钥
                      </p>
                      <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', lineHeight: '1.6' }}>
                        点击上方"+ 添加密钥"开始添加您的API密钥
                      </p>
                      <details style={{ marginTop: '1rem', textAlign: 'left', fontSize: '0.8rem' }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--primary-color)', marginBottom: '0.5rem' }}>
                          📚 首次使用？查看设置步骤
                        </summary>
                        <div style={{
                          padding: '0.75rem',
                          background: 'var(--surface-color)',
                          borderRadius: '6px',
                          marginTop: '0.5rem',
                          lineHeight: '1.8'
                        }}>
                          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 500 }}>
                            Google表格需要有"ApiKeys"标签页：
                          </p>
                          <ol style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                            <li>打开Google表格（与软件目录共用）</li>
                            <li>创建新标签页，命名为 <code style={{ background: '#f0f0f0', padding: '0 4px', borderRadius: '3px' }}>ApiKeys</code></li>
                            <li>在第一行添加表头：<br />
                              <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: '3px', fontSize: '0.75rem' }}>
                                user | apiKey | status | nickname
                              </code>
                            </li>
                            <li>然后回到这里点击"+ 添加密钥"</li>
                          </ol>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* API池状态显示 */}
            {usePool && apiPoolStatus && (
              <div className="api-pool-status">
                <div className="status-item">
                  <span className="status-label">可用密钥:</span>
                  <span className="status-value">{apiPoolStatus.total}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">当前使用:</span>
                  <span className="status-value">
                    {apiPoolStatus.current}/{apiPoolStatus.total}
                    {apiPoolStatus.currentNickname && ` (${apiPoolStatus.currentNickname})`}
                  </span>
                </div>
                {apiPoolStatus.failed > 0 && (
                  <div className="status-item status-warning">
                    <span className="status-label">失败标记:</span>
                    <span className="status-value">{apiPoolStatus.failed}</span>
                  </div>
                )}
                <button
                  className="secondary-btn"
                  onClick={rotateApiKey}
                  disabled={!apiPoolStatus || apiPoolStatus.total <= 1}
                >
                  ⏭️ 切换到下一个
                </button>
              </div>
            )}

            {poolError && (
              <div className="error-message" style={{ marginTop: '10px', padding: '10px', background: '#ff000020', borderRadius: '4px', color: '#ff6b6b' }}>
                ⚠️ {poolError}
              </div>
            )}

            <div className="modal-footer">
              <button className="secondary-btn" onClick={onClose}>{t('cancel')}</button>
              <button
                className="secondary-btn"
                onClick={handleRefreshPool}
                disabled={isRefreshing || (!useSharedPool && !storedUserEmail) || (useSharedPool && !user?.email)}
                title={useSharedPool ? '从共享API池获取最新密钥' : (!storedUserEmail ? '请先在首页设置邮箱' : '从Google Sheet读取最新密钥列表')}
              >
                {isRefreshing ? '刷新中...' : '🔄 刷新池'}
              </button>
              <button
                className="primary"
                onClick={handleSavePool}
                disabled={isRefreshing}
              >
                {isRefreshing ? '启用中...' : '✓ 启用自动轮换'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 添加/编辑API密钥弹窗 */}
      {showAddKeyModal && (
        <div
          className="modal-overlay"
          style={{ zIndex: 10001 }}
          onMouseDown={() => {
            setShowAddKeyModal(false);
            setEditingKey(null);
          }}
        >
          <div
            className="modal-content"
            style={{ maxWidth: '500px', padding: '1.5rem' }}
            onMouseDown={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 600 }}>
              {editingKey ? '✏️ 编辑API密钥' : (batchMode ? '📦 批量添加API密钥' : '➕ 添加新API密钥')}
            </h3>

            {/* 批量模式切换 - 仅在非编辑模式显示 */}
            {!editingKey && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
                padding: '0.5rem 0.75rem',
                background: batchMode ? '#e3f2fd' : 'transparent',
                borderRadius: '6px',
                border: `1px solid ${batchMode ? '#2196f3' : 'transparent'}`
              }}>
                <input
                  type="checkbox"
                  id="batchModeToggle"
                  checked={batchMode}
                  onChange={(e) => {
                    setBatchMode(e.target.checked);
                    setNewKeyInput('');
                  }}
                  style={{ width: '16px', height: '16px' }}
                />
                <label htmlFor="batchModeToggle" style={{ fontSize: '0.9rem', cursor: 'pointer', color: batchMode ? '#1976d2' : 'inherit' }}>
                  批量添加模式 {batchMode && '(每行一个密钥)'}
                </label>
              </div>
            )}

            {/* 消息提示 */}
            {saveMessage && (
              <div style={{
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                borderRadius: '6px',
                background: saveMessage.type === 'success' ? '#4caf5020' : '#ff000020',
                border: `1px solid ${saveMessage.type === 'success' ? '#4caf50' : '#ff6b6b'}`,
                color: saveMessage.type === 'success' ? '#2e7d32' : '#d32f2f',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span>{saveMessage.type === 'success' ? '✓' : '⚠'}</span>
                <span>{saveMessage.text}</span>
              </div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
                {batchMode ? 'API密钥列表' : 'API密钥'} {!editingKey && <span style={{ color: '#ff6b6b' }}>*</span>}
              </label>
              {batchMode ? (
                <textarea
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  placeholder={'每行一个API密钥，格式:\nAIzaSy...\nAIzaSy... 备注名称\nAIzaSy...,备注名称'}
                  style={{
                    width: '100%',
                    minHeight: '150px',
                    padding: '0.6rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontFamily: 'monospace',
                    color: '#333',
                    resize: 'vertical'
                  }}
                />
              ) : (
                <input
                  type="text"
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  placeholder="输入完整的API密钥"
                  disabled={!!editingKey}
                  style={{
                    width: '100%',
                    padding: '0.6rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    background: editingKey ? '#f5f5f5' : 'white',
                    color: '#333'
                  }}
                />
              )}
              {editingKey && (
                <small style={{ color: 'var(--text-muted-color)', fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                  * API密钥不可修改，只能修改备注
                </small>
              )}
              {batchMode && (
                <small style={{ color: 'var(--text-muted-color)', fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                  <Lightbulb size={12} className="inline mr-1" /> 可以直接粘贴多个密钥，每行一个。支持格式: "密钥" 或 "密钥 备注" 或 "密钥,备注"
                </small>
              )}
            </div>

            {/* 备注输入框 - 仅在非批量模式显示 */}
            {!batchMode && (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
                  备注名称 <span style={{ color: 'var(--text-muted-color)', fontWeight: 400 }}>（可选）</span>
                </label>
                <input
                  type="text"
                  value={newNicknameInput}
                  onChange={(e) => setNewNicknameInput(e.target.value)}
                  placeholder="例如: 主账号、备用密钥等"
                  style={{
                    width: '100%',
                    padding: '0.6rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    color: '#333'
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                className="secondary-btn"
                onClick={() => {
                  setShowAddKeyModal(false);
                  setEditingKey(null);
                }}
              >
                取消
              </button>
              <button
                className="primary"
                onClick={editingKey ? handleSaveEditedKey : handleSaveNewKey}
                disabled={isLoadingKeys || (!editingKey && !newKeyInput.trim())}
              >
                {isLoadingKeys ? '保存中...' : (editingKey ? '保存修改' : '添加密钥')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      {confirmDelete && (
        <div
          className="modal-overlay"
          style={{ zIndex: 10002 }}
          onMouseDown={() => setConfirmDelete(null)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: '400px', padding: '1.5rem' }}
            onMouseDown={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 600, color: '#d32f2f' }}>
              🗑️ 确认删除
            </h3>
            <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', lineHeight: '1.6' }}>
              确定要删除这个API密钥吗？
              {confirmDelete.nickname && (
                <><br /><strong>备注：{confirmDelete.nickname}</strong></>
              )}
              <br />
              <code style={{ fontSize: '0.8rem', background: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>
                {confirmDelete.apiKey.substring(0, 15)}...
              </code>
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                className="secondary-btn"
                onClick={() => setConfirmDelete(null)}
                disabled={isLoadingKeys}
              >
                取消
              </button>
              <button
                style={{
                  padding: '0.5rem 1rem',
                  background: '#d32f2f',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 500
                }}
                onClick={confirmDeleteApiKey}
                disabled={isLoadingKeys}
              >
                {isLoadingKeys ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

const NAV_ICON_NAMES: Record<Tool, string> = {
  studio: 'palette',
  magicCanvas: 'collections',
  prompt: 'image_search',
  desc: 'hub',
  template: 'drive_file_rename_outline',
  translate: 'translate',
  subemail: 'mail_outline',
  script: 'event_note',
  directory: 'folder_open',
  imageRecognition: 'center_focus_weak',
  sheetMind: 'table_chart',
  copyDedup: 'content_copy',
  proDedup: 'fingerprint',
  mindMap: 'tips_and_updates',
  aiToolsDirectory: 'apps',
};

const NAV_ITEMS: { tool: Tool; labelKey: keyof typeof translations.zh }[] = [
  { tool: 'studio', labelKey: 'navStudio' },
  { tool: 'magicCanvas', labelKey: 'navMagicCanvas' },
  { tool: 'prompt', labelKey: 'navPrompt' },
  { tool: 'imageRecognition', labelKey: 'navImageRecognition' },
  { tool: 'desc', labelKey: 'navDesc' },
  { tool: 'proDedup', labelKey: 'navProDedup' },
  { tool: 'translate', labelKey: 'navTranslate' },
  { tool: 'script', labelKey: 'navScriptTool' },
  { tool: 'sheetMind', labelKey: 'navSheetMind' },
  { tool: 'mindMap', labelKey: 'navMindMap' },
  { tool: 'template', labelKey: 'navTemplate' },
  { tool: 'subemail', labelKey: 'navSubEmail' },
  { tool: 'aiToolsDirectory', labelKey: 'navAIToolsDirectory' },
  { tool: 'copyDedup', labelKey: 'navCopyDedup' },
];

// 2025年12月 Gemini API 规范模型选项
const TEXT_MODEL_OPTIONS = [
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
  { value: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview' },
];

const IMAGE_MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash-image', label: 'gemini-2.5-flash-image' },
  { value: 'gemini-3-pro-image-preview', label: 'gemini-3-pro-image-preview (4K)' },
  { value: 'imagen-4.0-generate-001', label: 'imagen-4.0-generate-001' },
];

// 图片分辨率选项
const IMAGE_RESOLUTION_OPTIONS = [
  { value: '1K', label: '1K (1024px)' },
  { value: '2K', label: '2K (2048px)' },
];

// 缩放选项配置 - 细粒度5%增量
const UI_SCALE_OPTIONS = [70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 130, 150, 200, 250, 300];
const FONT_SCALE_OPTIONS = [80, 85, 90, 95, 100, 105, 110, 115, 120, 130, 150];

/**
 * 智能初始缩放检测
 * 根据屏幕分辨率和设备像素比自动计算推荐的缩放值
 * 解决在高分辨率设备上首次使用时界面太小的问题
 */
const suggestInitialScale = (): number => {
  if (typeof window === 'undefined') return 100;
  const width = window.screen.width;
  const dpr = window.devicePixelRatio || 1;

  // 4K 显示器 (3840x2160 或更高)
  if (width >= 3840) return 180;

  // 2K / QHD 显示器 (2560x1440)
  if (width >= 2560) return 140;

  // 大显示器但无系统缩放 (DPR 1)，通常是老式高分辨率显示器
  if (width > 1600 && dpr === 1) return 115;

  // 中等分辨率但高 DPR (如 1920x1080 但 DPR 2，常见于一些笔记本)
  if (width >= 1440 && dpr >= 1.5) return 105;

  // 标准 HD 屏幕或高 DPR 移动设备
  return 100;
};

// 版本配置 - 每次发布新版本前，先把当前版本部署到 channel
// 命令：firebase hosting:channel:deploy v2-5-0 --expires 30d
// 然后添加到下面的列表中
const VERSION_HISTORY = [
  { version: '2.6.9', date: '2025-12-31', url: 'https://ai-toolkit-b2b78.web.app', isCurrent: true },
  { version: '2.6.8', date: '2025-12-30', url: 'https://ai-toolkit-b2b78--v2-6-8-22v256no.web.app', isCurrent: false },
  { version: '2.5.1', date: '2025-12-21', url: 'https://ai-toolkit-b2b78--v2-5-1-2nti7xkx.web.app', isCurrent: false },
];


// 版本选择器组件
const VersionSelector = ({ currentVersion, buildTime }: { currentVersion: string; buildTime: string }) => {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div style={{ position: 'fixed', bottom: '8px', right: '12px', zIndex: 1000 }}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: '10px',
          color: 'var(--text-muted-color, #666)',
          opacity: showMenu ? 1 : 0.6,
          padding: '4px 8px',
          borderRadius: '4px',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = showMenu ? '1' : '0.6'}
        title="点击查看版本历史"
      >
        v{currentVersion}
        {buildTime && <span style={{ marginLeft: '4px', opacity: 0.7 }}>({buildTime})</span>}
        <span style={{ marginLeft: '4px' }}>▾</span>
      </button>

      {showMenu && (
        <>
          {/* 点击外部关闭 */}
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }}
            onClick={() => setShowMenu(false)}
          />

          {/* 版本菜单 */}
          <div style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: '4px',
            background: 'var(--bg-color, #1a1a2e)',
            border: '1px solid var(--border-color, #333)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            padding: '8px 0',
            minWidth: '200px',
            zIndex: 999
          }}>
            <div style={{
              padding: '4px 12px 8px',
              fontSize: '11px',
              color: 'var(--text-muted-color)',
              borderBottom: '1px solid var(--border-color, #333)',
              marginBottom: '4px'
            }}>
              版本历史
            </div>

            {VERSION_HISTORY.map((v) => (
              <button
                key={v.version}
                onClick={() => {
                  if (!v.isCurrent) {
                    if (confirm(`确定要切换到 v${v.version} 吗？\n\n注意：切换后您的当前工作状态可能不会自动保存。`)) {
                      window.location.href = v.url;
                    }
                  }
                  setShowMenu(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '8px 12px',
                  background: v.isCurrent ? 'rgba(75, 150, 255, 0.1)' : 'transparent',
                  border: 'none',
                  cursor: v.isCurrent ? 'default' : 'pointer',
                  textAlign: 'left',
                  fontSize: '12px',
                  color: v.isCurrent ? 'var(--primary-color, #4dabff)' : 'var(--text-color, #fff)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => !v.isCurrent && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => e.currentTarget.style.background = v.isCurrent ? 'rgba(75, 150, 255, 0.1)' : 'transparent'}
              >
                <span>
                  v{v.version}
                  {v.isCurrent && <span style={{ marginLeft: '6px', fontSize: '10px', opacity: 0.7 }}>(当前)</span>}
                </span>
                <span style={{ fontSize: '10px', opacity: 0.6 }}>{v.date}</span>
              </button>
            ))}

            <div style={{
              padding: '8px 12px 4px',
              fontSize: '10px',
              color: 'var(--text-muted-color)',
              borderTop: '1px solid var(--border-color, #333)',
              marginTop: '4px',
              opacity: 0.7
            }}>
              <Lightbulb size={12} className="inline mr-1" /> 旧版本可能缺少新功能
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const App = () => {
  const { t, setLanguage, language } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { isKeySet, getAiInstance, usePool, apiPoolStatus, apiKey, rotateApiKey } = useApi();
  const { user, signOut, loading: authLoading } = useAuth();
  const [activeTool, setActiveTool] = useState<Tool>('imageRecognition'); // 默认打开 AI 图片识别
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showCloudSyncPanel, setShowCloudSyncPanel] = useState(false);
  const [emailSyncStatus, setEmailSyncStatus] = useState<SyncStatus>('idle');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isPresetControlsExpanded, setIsPresetControlsExpanded] = useState(false);
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  const [showHelpCenter, setShowHelpCenter] = useState(false);
  const [hideToolbar, setHideToolbar] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hide_global_toolbar') === 'true';
    }
    return false;
  });
  const [showWebTooltip, setShowWebTooltip] = useState(false);
  const [webTooltipPos, setWebTooltipPos] = useState({ top: 0, left: 0 });
  const webBtnRef = React.useRef<HTMLButtonElement>(null);
  const [settingsPanelPos, setSettingsPanelPos] = useState({ top: 0, left: 0 });
  const settingsBtnRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const resetUserSelect = () => {
      if (document.body.style.userSelect === 'none') {
        document.body.style.userSelect = '';
        (document.body.style as any).webkitUserSelect = '';
      }
    };

    const handlePointerUp = () => resetUserSelect();
    const handleVisibility = () => {
      if (document.hidden) resetUserSelect();
    };

    resetUserSelect();
    window.addEventListener('mouseup', handlePointerUp, true);
    window.addEventListener('touchend', handlePointerUp, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('blur', handlePointerUp);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('mouseup', handlePointerUp, true);
      window.removeEventListener('touchend', handlePointerUp, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('blur', handlePointerUp);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // 版本切换：网站版 vs AI Studio 版 - 自动检测当前环境
  const [appEdition, setAppEdition] = useState<'website' | 'aistudio'>(() => {
    if (typeof window === 'undefined') return 'website';

    // 根据多种条件检测是否在 AI Studio 环境
    const hostname = window.location.hostname;
    const href = window.location.href;
    const referrer = document.referrer || '';

    // 1. 检查 hostname 是否包含 AI Studio 相关域名
    if (hostname.includes('aistudio') || hostname.includes('googleusercontent')) {
      return 'aistudio';
    }

    // 2. 检查是否在 iframe 中（AI Studio 应用运行在 iframe 里）
    const isInIframe = window.self !== window.top;

    // 3. 检查 referrer 是否来自 AI Studio
    if (isInIframe && referrer.includes('aistudio.google.com')) {
      return 'aistudio';
    }

    // 4. 检查 URL 参数（AI Studio 会添加特定参数）
    if (href.includes('fullscreenApplet=true') || href.includes('showAssistant=true')) {
      return 'aistudio';
    }

    // 5. 如果在 iframe 中且不是我们自己的网站域名，可能是 AI Studio
    if (isInIframe && !hostname.includes('ai-toolkit') && !hostname.includes('localhost')) {
      return 'aistudio';
    }

    return 'website';
  });
  const [showEditionTooltip, setShowEditionTooltip] = useState(false);
  const [editionTooltipPos, setEditionTooltipPos] = useState({ top: 0, left: 0 });
  const editionBtnRef = React.useRef<HTMLButtonElement>(null);

  // 全局 UI 缩放 - 默认 100%，不自动调整
  const [uiScale, setUiScale] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    try {
      const saved = localStorage.getItem('app_ui_scale');
      if (saved) {
        return parseInt(saved, 10);
      }
      // 默认 100%，不再自动检测
      return 100;
    } catch {
      return 100;
    }
  });

  // 文字大小缩放
  const [fontScale, setFontScale] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    try {
      const saved = localStorage.getItem('app_font_scale');
      return saved ? parseInt(saved, 10) : 100;
    } catch {
      return 100;
    }
  });

  // 应用缩放（跨浏览器）：统一通过 html font-size（rem）实现
  useEffect(() => {
    // 清理旧版本遗留的非标准 zoom / inline font-size（避免覆盖 CSS 方案）
    (document.documentElement.style as any).zoom = '';
    document.documentElement.style.fontSize = '';

    const uiScaleFactor = uiScale / 100;
    const fontScaleFactor = fontScale / 100;
    const combinedScale = uiScaleFactor * fontScaleFactor;

    document.documentElement.style.setProperty('--app-scale', String(combinedScale));
    localStorage.setItem('app_ui_scale', String(uiScale));
    localStorage.setItem('app_font_scale', String(fontScale));
  }, [uiScale, fontScale]);

  // 模型迁移映射 - 旧模型 -> 新模型
  const migrateModel = (model: string, isImage: boolean): string => {
    const TEXT_MIGRATION: Record<string, string> = {
      'gemini-2.5-flash': 'gemini-3-flash-preview',
      'gemini-pro': 'gemini-3-flash-preview',
      'gemini-1.5-flash': 'gemini-3-flash-preview',
      'gemini-1.5-pro': 'gemini-3-pro-preview',
    };
    const IMAGE_MIGRATION: Record<string, string> = {
      'gemini-3-pro-image-preview': 'gemini-2.5-flash-image',
    };
    const migration = isImage ? IMAGE_MIGRATION : TEXT_MIGRATION;
    return migration[model] || model;
  };

  const [textModel, setTextModel] = useState<string>(() => {
    if (typeof window === 'undefined') return 'gemini-3-flash-preview';
    try {
      const saved = localStorage.getItem('app_text_model');
      if (!saved) return 'gemini-3-flash-preview';
      const migrated = migrateModel(saved, false);
      if (migrated !== saved) {
        localStorage.setItem('app_text_model', migrated);
      }
      return migrated;
    } catch {
      return 'gemini-3-flash-preview';
    }
  });

  const [imageModel, setImageModel] = useState<string>(() => {
    if (typeof window === 'undefined') return 'gemini-2.5-flash-image';
    try {
      const saved = localStorage.getItem('app_image_model');
      if (!saved) return 'gemini-2.5-flash-image';
      const migrated = migrateModel(saved, true);
      if (migrated !== saved) {
        localStorage.setItem('app_image_model', migrated);
      }
      return migrated;
    } catch {
      return 'gemini-2.5-flash-image';
    }
  });

  const [imageResolution, setImageResolution] = useState<string>(() => {
    if (typeof window === 'undefined') return '1K';
    try {
      return localStorage.getItem('app_image_resolution') || '1K';
    } catch {
      return '1K';
    }
  });

  // 保存分辨率到 localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('app_image_resolution', imageResolution);
    }
  }, [imageResolution]);

  // ==================== Firestore 云端同步 ====================
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'loading' | 'syncing' | 'success' | 'error'>('idle');
  const cloudSyncRef = useRef<boolean>(false); // 防止循环同步

  // 登录后加载云端设置
  useEffect(() => {
    if (!user) {
      setCloudSyncStatus('idle');
      return;
    }

    const loadCloudSettings = async () => {
      setCloudSyncStatus('loading');
      try {
        const settings = await loadUserSettings(user.uid);
        if (settings) {
          cloudSyncRef.current = true; // 标记为云端加载，防止触发保存
          if (settings.uiScale) setUiScale(settings.uiScale);
          if (settings.fontScale) setFontScale(settings.fontScale);
          if (settings.theme && settings.theme !== theme) toggleTheme();
          if (settings.language) setLanguage(settings.language);
          if (settings.textModel) setTextModel(settings.textModel);
          if (settings.imageModel) setImageModel(settings.imageModel);
          console.log('[Cloud Sync] Loaded settings from Firestore:', settings);
          setTimeout(() => { cloudSyncRef.current = false; }, 500);
        }
        setCloudSyncStatus('success');
      } catch (error) {
        console.error('[Cloud Sync] Failed to load settings:', error);
        setCloudSyncStatus('error');
      }
    };

    loadCloudSettings();
  }, [user?.uid]);

  // 设置变更时保存到云端 (防抖)
  const saveSettingsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!user || cloudSyncRef.current) return;

    if (saveSettingsTimeoutRef.current) {
      clearTimeout(saveSettingsTimeoutRef.current);
    }

    saveSettingsTimeoutRef.current = setTimeout(async () => {
      setCloudSyncStatus('syncing');
      try {
        await saveUserSettings(user.uid, {
          uiScale,
          fontScale,
          theme,
          language,
          textModel,
          imageModel
        });
        console.log('[Cloud Sync] Settings saved to Firestore');
        setCloudSyncStatus('success');
      } catch (error) {
        console.error('[Cloud Sync] Failed to save settings:', error);
        setCloudSyncStatus('error');
      }
    }, 2000); // 2秒防抖

    return () => {
      if (saveSettingsTimeoutRef.current) {
        clearTimeout(saveSettingsTimeoutRef.current);
      }
    };
  }, [user?.uid, uiScale, fontScale, theme, language, textModel, imageModel]);
  // =============================================================

  // presetUser 自动使用登录用户的邮箱，无需单独输入
  const [presetUser, setPresetUser] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('app_preset_user') || '';
    } catch {
      return '';
    }
  });

  // 登录时自动同步 presetUser
  useEffect(() => {
    if (user?.email) {
      const normalizedEmail = user.email.toLowerCase();
      if (presetUser !== normalizedEmail) {
        setPresetUser(normalizedEmail);
        localStorage.setItem('app_preset_user', normalizedEmail);
        console.log('[Preset] Auto-set presetUser from login:', normalizedEmail);
      }
    }
  }, [user?.email]);
  const presetImportRef = useRef<HTMLInputElement>(null);

  const [promptState, setPromptState] = useState<PromptToolState>({ sessions: [], activeSessionId: null, activeImageId: null, userInput: {}, error: null });
  const [descState, setDescState] = useState<DescState>(() => getInitialDescState());
  const descControlRef = useRef<DescControlHandlers | null>(null);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [imageToEdit, setImageToEdit] = useState<File | null>(null);
  const imageSaveHandlerRef = useRef<(() => void) | null>(null);
  const magicSaveHandlerRef = useRef<(() => void) | null>(null);
  const templateSaveHandlerRef = useRef<(() => void) | null>(null);
  const [imageSaveStatus, setImageSaveStatus] = useState<PresetSaveStatus | null>(null);
  const [magicSaveStatus, setMagicSaveStatus] = useState<PresetSaveStatus | null>(null);
  const [templateSaveStatus, setTemplateSaveStatus] = useState<PresetSaveStatus | null>(null);
  const [isImageSaveReady, setIsImageSaveReady] = useState(false);
  const [isMagicSaveReady, setIsMagicSaveReady] = useState(false);
  const [isTemplateSaveReady, setIsTemplateSaveReady] = useState(false);
  const [imageRecognitionState, setImageRecognitionState] = useState<ImageRecognitionState>(initialImageRecognitionState);
  const [sheetMindState, setSheetMindState] = useState<SheetMindState>(initialSheetMindState);
  const [imageStudioState, setImageStudioState] = useState<PortraitState>({
    images: [],
    activeImageId: null,
    activeTab: 'portrait_retouch',
    nextPresetId: 1000,
    nextCategoryId: 1,
    selection: { active: false, rects: [], currentColor: SELECTION_COLORS[0] },
    brush: { active: false, size: 20, color: SELECTION_COLORS[0], paths: [] },
    renamingCategoryId: null,
    isAddingNewCategory: false,
    editingPreset: null,
    customPrompts: {
      retouch: '', outfit: '', expression: '', hairstyle: '', background: '', matting: '', general: '', 'portrait_retouch': '', filter: ''
    },
    categories: [
      {
        id: 'outfit', label: "一键换装", isDeletable: false, presets: [
          { id: 'oo-1', label: "休闲装", prompt: "将人物的服装换成T恤和牛仔裤等休闲装" },
          { id: 'oo-2', label: "西服领带", prompt: "将人物的服装换成带领带的正式商务西装" },
          { id: 'oo-3', label: "连衣裙", prompt: "将人物的服装换成优雅的连衣裙" },
          { id: 'oo-4', label: "运动服", prompt: "将人物的服装换成连帽衫和运动裤等运动服" },
          { id: 'oo-5', label: "白色外袍", prompt: "将人物衣服改为白色外袍" },
          { id: 'oo-6', label: "蓝色外袍", prompt: "将人物衣服改为蓝色外袍" },
          { id: 'oo-7', label: "浅蓝色外袍", prompt: "将人物衣服改为浅蓝色外袍" },
          { id: 'oo-8', label: "绿色外袍", prompt: "将人物衣服改为绿色外袍" },
          { id: 'oo-9', label: "浅绿色外袍", prompt: "将人物衣服改为浅绿色外袍" },
          { id: 'oo-10', label: "红色外袍", prompt: "将人物衣服改为红色外袍" },
          { id: 'oo-11', label: "金色外袍", prompt: "将人物衣服改为金色外袍" },
          { id: 'oo-12', label: "白色内袍", prompt: "将人物衣服改为白色内袍" },
        ]
      },
      {
        id: 'portrait_retouch', label: "人像P图", isDeletable: false, presets: [
          { "id": "pr-101", "label": "删除脸部高光", "prompt": "删除人物面部高光，使得光线柔和自然" },
          { "id": "pr-102", "label": "去除强烈阴影", "prompt": "去除人物面部的强烈阴影，让光线对比更柔和自然" },
          { "id": "pr-103", "label": "皮肤白皙红润", "prompt": "修复肌肤白皙细腻红润有光泽" },
          { "id": "pr-104", "label": "棕色头发", "prompt": "头发颜色改为棕色的" },
          { "id": "pr-105", "label": "添加圣心", "prompt": "为人物胸前添加红色圣心" },
          { "id": "pr-106", "label": "七剑圣心", "prompt": "为人物胸前添加插着七把匕首的圣心" },
          { "id": "pr-107", "label": "修复玛丽亚妆容", "prompt": "玛丽亚美丽成熟的面容" },
          { "id": "pr-108", "label": "双手合十", "prompt": "人物动作改为双手合十祈祷状" },
          { "id": "pr-109", "label": "十指交叉祈祷", "prompt": "人物动作改为双手握紧，十指交叉相扣的祈祷" }
        ]
      },
      {
        id: 'background', label: "背景替换", isDeletable: false, presets: [
          { "id": "bg-101", "label": "春日樱花", "prompt": "修改背景为春日樱花场景，画面通透明亮" },
          { "id": "bg-102", "label": "夏日田园", "prompt": "背景修改为温馨明媚的夏日田园，绿意盎然，十分惬意。" },
          { "id": "bg-103", "label": "秋叶枫景", "prompt": "背景修改为色彩浓郁的秋叶景象，红色，黄色，橙色的树叶构成一幅美丽的画卷，色彩通透明亮。" },
          { "id": "bg-104", "label": "冬日雪景", "prompt": "背景修改为冬日白雪皑皑的场景，雪地在阳光的照射下画面温柔唯美。" },
          { "id": "bg-105", "label": "菲-地震", "prompt": "背景修改为菲律宾地震后的城市街道，背景中楼房倒塌，道路裂开，蓝天白云" },
          { "id": "bg-106", "label": "美丽花园", "prompt": "背景修改为阳光明媚的花园，繁花盛开、鸟语轻鸣、微风拂动，绿叶斑驳、空气通透，氛围宁静而生机盎然。" },
          { "id": "bg-107", "label": "乡村场景", "prompt": "背景修改为乡村场景，生动、美丽，充满光明的，有生机的" },
          { "id": "bg-108", "label": "教堂门前", "prompt": "背景修改为浅色的基督教教堂门前，阳光明媚，蓝天白云。" },
          { "id": "bg-109", "label": "公园", "prompt": "背景修改为绿意安然的公园场景,光线通透明亮，氛围温柔浪漫。" },
          { "id": "bg-110", "label": "鸟语花香", "prompt": "修改背景：鸟语花香，画面通透明亮" },
          { id: 'bo-1', label: "办公室", prompt: "将背景更换为现代办公室" },
          { id: 'bo-2', label: "海滩", prompt: "将背景更换为阳光明媚的海滩" },
          { id: 'bo-3', label: "赛博朋克城市", prompt: "将背景更换为赛博朋克风格的城市夜景" },
        ]
      },
      {
        id: 'filter', label: "滤镜", isDeletable: false, presets: [
          { "id": "ft-201", "label": "金色神殿", "prompt": "背景修改为金色神殿或教堂内部，圣光从高窗倾泻，空气中漂浮微尘与光晕，庄严而神圣。" },
          { "id": "ft-202", "label": "天国圣境", "prompt": "背景修改为天国般的光辉空间，白云环绕，圣光从远处扩散，柔和而纯净，充满神圣氛围。" },
          { "id": "ft-203", "label": "圣洁金辉", "prompt": "背景修改为被温柔金色光辉笼罩的空间，光线柔和细腻，如圣灵降临般神圣辉煌。" },
          { "id": "ft-204", "label": "梦幻光晕", "prompt": "背景修改为柔光与色晕交织的梦幻空间，粉金蓝渐层，光线通透明亮，氛围温柔浪漫。" },
          { "id": "ft-205", "label": "星空与流光", "prompt": "背景修改为璀璨星空与流光交织的夜幕，色彩深邃梦幻，带有神秘的宇宙气息。" },
          { "id": "ft-206", "label": "天空与光之海", "prompt": "背景修改为漂浮的云海与流动的光之海，柔光涌动，色彩通透明亮，空间感广阔神圣。" },
          { "id": "ft-207", "label": "神圣花雨", "prompt": "背景修改为光中飘落花瓣与金色微尘的圣洁场景，象征神恩降临与祝福，画面温柔唯美。" },
          { "id": "ft-208", "label": "纯白辉映", "prompt": "背景修改为纯白柔光中散发微微金辉的空间，光线清澈柔和，空气通透洁净，带来纯净、宁静与圣洁的感受。" },
          { "id": "ft-209", "label": "光羽空间", "prompt": "背景修改为漂浮光羽与微尘的唯美空间，光线闪烁如星尘，空气温柔流动，带有诗意与灵性的静谧美感。" },
          { "id": "ft-210", "label": "彩晕之境", "prompt": "背景修改为彩晕与柔光交织的空间，光线呈粉金、珍珠白与浅蓝渐层，通透、安静、如天国般柔美。" },
          { "id": "ft-211", "label": "梦中光海", "prompt": "背景修改为光影流动的梦幻海洋，柔光波动，空间无边，色彩柔和流畅，呈现极致唯美与神圣宁静感。" },
          { "id": "ft-212", "label": "圣光弥漫", "prompt": "背景修改为被圣光完全笼罩的空间，光线自上而下倾泻，如柔雾与金辉交织，空间神圣纯净，充满安详与美感。" },
          { "id": "ft-213", "label": "金色微尘空间", "prompt": "背景修改为空气中漂浮金色微尘的空间，光线温柔闪烁，明亮却不刺眼，营造出神圣与梦幻并存的氛围。" },
          { "id": "ft-214", "label": "白金柔光空间", "prompt": "背景修改为白金色柔光流动的空间，空气中有细微光线颗粒闪动，画面极度纯净，神圣而高级。" },
          { "id": "ft-215", "label": "纯光梦境", "prompt": "背景修改为纯光构成的梦幻空间，无明显形体，仅有流动的柔和光色，整体如圣洁梦境般宁静唯美。" },
          { "id": "ft-216", "label": "天国之光", "prompt": "背景修改为充满纯净白金光线的天国空间，光线从远处延展，清澈而不耀眼，空气晶莹通透，画面高亮圣洁，带有神性与永恒感。" },
          { "id": "ft-217", "label": "纯光圣境", "prompt": "背景修改为由纯净光线构成的空间，光感清澈，层次分明，画面洁净无杂色，整体通透明亮，如天国的永恒光域。" },
          { "id": "ft-218", "label": "圣辉流境", "prompt": "背景修改为金白色与淡粉光辉交织的空间，光线自然流动，清晰明亮，呈现高贵、温柔与超凡的圣洁气息。" },
          { "id": "ft-219", "label": "荣光之境", "prompt": "背景修改为笼罩在纯净金光中的空间，光线层叠细腻，反射柔和，营造庄严、华美、纯净而神圣的氛围。" },
          { "id": "ft-220", "label": "光羽圣域", "prompt": "背景修改为漂浮细光与闪亮光粒的明亮空间，光线通透流动，清晰柔亮，整体洁净纯美，带有灵性与平静。" },
          { "id": "ft-221", "label": "金辉之海", "prompt": "背景修改为金色光线反射的光面空间，画面明亮透彻，层次细腻，呈现高贵庄严与天国般的明净氛围。" },
          { "id": "ft-222", "label": "圣洁穹顶光域", "prompt": "背景修改为穹顶形的纯光空间，线条柔顺、明亮清晰，光线集中于中心，营造出仿若神殿中的神圣明辉感。" },
          { "id": "ft-223", "label": "圣花光域", "prompt": "背景修改为光线纯净的空间中漂浮着柔光花瓣，花色以白、金、淡粉为主，通透明亮，整体带有神圣、温柔与天国气息。" },
          { "id": "ft-224", "label": "花光圣境", "prompt": "背景修改为被金白光辉笼罩的空间，细小花瓣与光粒在空气中轻盈散布，光线清澈柔亮，氛围高贵而神圣。" },
          { "id": "ft-225", "label": "圣洁花冠空间", "prompt": "背景修改为由花朵与光线交织形成的环形光带，花色洁净柔和，整体通透明亮，呈现出天国般庄严与纯美的气质。" },
          { "id": "ft-226", "label": "光羽花雨", "prompt": "背景修改为清澈空间中轻盈落下的花瓣与光羽，光感晶莹，色调柔亮纯净，带有祝福般的神圣浪漫感。" },
          { "id": "ft-227", "label": "光中花海", "prompt": "背景修改为沐浴在纯净金白光中的花海远景，花朵仿若光之化身，色调明快通透，带有天国般的静谧与庄严。" },
          { "id": "ft-228", "label": "天国花境", "prompt": "背景修改为光与花交织的神圣空间，花色柔和纯净，金光映照其上，整体氛围清亮唯美，极具神性与安宁感。" },
          { "id": "ft-229", "label": "圣辉之源", "prompt": "背景修改为光线汇聚成的明亮中心，白金光自内向外流动，清澈无杂，整体高贵、神圣、通透明亮。" },
          { "id": "ft-230", "label": "纯净之境", "prompt": "背景修改为完全由白与金色光构成的空间，无任何杂质或阴影，通透明亮，静谧高洁，仿若圣光之源。" },
          { "id": "ft-231", "label": "圣明空间", "prompt": "背景修改为纯白空间中闪耀微光的光域，光线干净、均匀、无雾感，呈现绝对纯净与平和的美感。" },
          { "id": "ft-232", "label": "金辉极境", "prompt": "背景修改为被金色柔光环绕的通透空间，光线明亮不刺眼，反射细腻，画面庄严而温柔，充满神性。" },
          { "id": "ft-233", "label": "永恒白光域", "prompt": "背景修改为纯白无垢的光域，光线均匀散射，空气透亮如玻璃，呈现极简、神圣与永恒的视觉纯度。" },
          { "id": "ft-234", "label": "光之序曲", "prompt": "背景修改为由柔光构成的抽象空间，光层叠交错，节奏柔和自然，呈现纯净、灵性与艺术的和谐美感。" },
          { "id": "ft-235", "label": "天心光原", "prompt": "背景修改为中心放射的纯净光源空间，光线明亮柔和，带有安详的天国气息，整体平衡、纯洁而庄重。" },
          { "id": "ft-236", "label": "圣灵之光", "prompt": "背景修改为柔和白金光环围绕的空间，光线纯净通透，充满灵性气息，呈现出神圣、宁静与美的极致融合。" }
        ]
      },
      {
        id: 'matting', label: "智能抠图", isDeletable: false, presets: [
          { id: 'mo-1', label: "保留主体去背景", prompt: "移除背景，保留画面主体" },
          { id: 'mo-2', label: "去除前景保留背景", prompt: "移除前景物体，保留背景" },
          { id: 'mo-3', label: "移除框选区域", prompt: "mattingOption3" }, // Special key
          { id: 'mo-4', label: "自动去除水印", prompt: "自动检测并移除图像中的所有水印" },
          { id: 'mo-5', label: "去除文字", prompt: "移除图像中的所有文字" },
          { id: 'mo-6', label: "去除Logo", prompt: "移除图像中的所有Logo" },
          { id: 'mo-7', label: "去除对话气泡", prompt: "移除图像中的所有对话气泡及其中的文字" },
        ]
      },
      { id: 'general', label: "自定义修改", isDeletable: false, presets: [] },
    ],
  });
  const [magicCanvasState, setMagicCanvasState] = useState<MagicCanvasState>(initialMagicCanvasState);
  const [smartTranslateState, setSmartTranslateState] = useState<SmartTranslateState>(initialSmartTranslateState);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('app_preset_user', presetUser);
    } catch (e) {
      console.warn('Failed to store preset user', e);
    }
  }, [presetUser]);

  useEffect(() => {
    setImageSaveStatus(null);
    setMagicSaveStatus(null);
  }, [presetUser]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!presetUser) return;
    try {
      const raw = localStorage.getItem(`app_presets_${presetUser.toLowerCase()}`);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !data.categories) return;
      setImageStudioState(prev => {
        const categories = cloneCategories(data.categories);
        const customPrompts = ensureCustomPromptMap(categories, data.customPrompts || {});
        const activeTab = categories.some(c => c.id === prev.activeTab) ? prev.activeTab : (categories[0]?.id || prev.activeTab);
        return {
          ...prev,
          categories,
          customPrompts,
          nextPresetId: data.nextPresetId || prev.nextPresetId,
          nextCategoryId: data.nextCategoryId || prev.nextCategoryId,
          activeTab
        };
      });
      setPresetNotice(t('presetSyncSuccess', { count: data.categories.flatMap((c: any) => c.presets || []).length || 0 }));
    } catch (e) {
      console.warn('Failed to load local presets', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetUser]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!presetUser) return;
    try {
      const payload = {
        categories: imageStudioState.categories,
        customPrompts: imageStudioState.customPrompts,
        nextPresetId: imageStudioState.nextPresetId,
        nextCategoryId: imageStudioState.nextCategoryId,
      };
      localStorage.setItem(`app_presets_${presetUser.toLowerCase()}`, JSON.stringify(payload));
    } catch (e) {
      console.warn('Failed to save presets', e);
    }
  }, [presetUser, imageStudioState.categories, imageStudioState.customPrompts, imageStudioState.nextPresetId, imageStudioState.nextCategoryId]);

  const [templateBuilderState, setTemplateBuilderState] = useState<TemplateBuilderState>(() => getInitialTemplateBuilderState());
  const combinedTemplateInstruction = useMemo(
    () => buildCombinedTemplateText(templateBuilderState.sections, templateBuilderState.values),
    [templateBuilderState]
  );

  // =================== 邮箱云同步：自动推送 ===================
  const emailSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedImagesRef = useRef<string>('');

  // 登录时自动设置云同步邮箱并同步项目
  const projectsSyncedRef = useRef(false);
  useEffect(() => {
    if (user?.email) {
      const currentSyncEmail = getSavedSyncEmail();
      // 如果云同步邮箱未设置，或者与登录邮箱不同，则自动设置
      if (!currentSyncEmail || currentSyncEmail !== user.email.toLowerCase()) {
        console.log('[Email Sync] Auto-setting sync email to:', user.email);
        saveSyncEmail(user.email);
        setEmailSyncStatus('idle');
      }

      // 同步项目到邮箱云同步（只执行一次）
      if (!projectsSyncedRef.current && user.uid) {
        projectsSyncedRef.current = true;

        // 异步同步项目
        (async () => {
          try {
            const { listProjects } = await import('@/services/projectService');
            // 获取所有模块的项目
            const moduleIds = ['image-recognition', 'smart-translate', 'smart-translate-instant'] as const;
            const allProjects: any[] = [];

            for (const moduleId of moduleIds) {
              try {
                const projects = await listProjects(user.uid, moduleId, { maxCount: 100 });
                allProjects.push(...projects.map(p => ({
                  ...p,
                  moduleId,
                  createdAt: p.createdAt?.toMillis?.() || Date.now(),
                  updatedAt: p.updatedAt?.toMillis?.() || Date.now()
                })));
              } catch (e) {
                // 模块可能没有项目，忽略错误
              }
            }

            if (allProjects.length > 0) {
              console.log('[Email Sync] Syncing', allProjects.length, 'projects to email cloud sync');
              debouncedPush(user.email, {
                images: extractSyncableData(imageRecognitionState.images),
                projects: allProjects,
                settings: { language }
              });
            }
          } catch (error) {
            console.error('[Email Sync] Failed to sync projects:', error);
          }
        })();
      }
    }
  }, [user?.email, user?.uid]);

  // 自动推送：当图片状态变化时
  useEffect(() => {
    const syncEmail = getSavedSyncEmail();
    if (!syncEmail) return;

    // 只有已完成识别的图片才需要同步
    const successImages = imageRecognitionState.images.filter(img => img.status === 'success' && img.result);
    if (successImages.length === 0) return;

    // 检查是否有变化（用 id + result 的组合作为快照）
    const snapshot = JSON.stringify(successImages.map(img => ({
      id: img.id,
      result: img.result
    })));
    if (snapshot === lastSyncedImagesRef.current) return;
    lastSyncedImagesRef.current = snapshot;

    // 防抖推送（3秒）
    if (emailSyncTimeoutRef.current) {
      clearTimeout(emailSyncTimeoutRef.current);
    }

    setEmailSyncStatus('syncing');
    emailSyncTimeoutRef.current = setTimeout(() => {
      console.log('[Email Sync] Auto pushing', successImages.length, 'images with full state...');
      debouncedPush(syncEmail, {
        images: extractSyncableData(imageRecognitionState.images),
        prompt: imageRecognitionState.prompt,
        innovationInstruction: imageRecognitionState.innovationInstruction,
        globalInnovationTemplateId: imageRecognitionState.globalInnovationTemplateId,
        globalInnovationCount: imageRecognitionState.globalInnovationCount,
        globalInnovationRounds: imageRecognitionState.globalInnovationRounds,
        copyMode: imageRecognitionState.copyMode,
        viewMode: imageRecognitionState.viewMode,
        autoUploadGyazo: imageRecognitionState.autoUploadGyazo,
        pureReplyMode: imageRecognitionState.pureReplyMode,
        // 扩展同步：用户设置
        settings: {
          language,
          uiScale: parseFloat(localStorage.getItem('app_ui_scale') || '100'),
        }
      });
    }, 100);

    return () => {
      if (emailSyncTimeoutRef.current) {
        clearTimeout(emailSyncTimeoutRef.current);
      }
    };
  }, [imageRecognitionState.images, language]);

  // 初始化拉取：应用加载时自动拉取云端数据
  const emailSyncInitializedRef = useRef(false);
  useEffect(() => {
    if (emailSyncInitializedRef.current) return;

    const syncEmail = getSavedSyncEmail();
    if (!syncEmail) return;

    emailSyncInitializedRef.current = true;

    const initPull = async () => {
      try {
        setEmailSyncStatus('syncing');
        console.log('[Email Sync] Initial pull for:', syncEmail);
        const cloudData = await pullFromCloud(syncEmail);
        if (cloudData) {
          console.log('[Email Sync] Cloud data found:', {
            images: cloudData.images?.length || 0,
            prompt: cloudData.prompt ? 'yes' : 'no'
          });

          setImageRecognitionState(prev => {
            // 始终合并云端数据（智能合并，不会覆盖本地更新的数据）
            const mergedImages = cloudData.images?.length > 0
              ? mergeCloudDataToImages(prev.images, cloudData.images)
              : prev.images;

            return {
              ...prev,
              images: mergedImages,
              prompt: cloudData.prompt ?? prev.prompt,
              innovationInstruction: cloudData.innovationInstruction ?? prev.innovationInstruction,
              globalInnovationTemplateId: cloudData.globalInnovationTemplateId ?? prev.globalInnovationTemplateId,
              globalInnovationCount: cloudData.globalInnovationCount ?? prev.globalInnovationCount,
              globalInnovationRounds: cloudData.globalInnovationRounds ?? prev.globalInnovationRounds,
              copyMode: (cloudData.copyMode as any) ?? prev.copyMode,
              viewMode: (cloudData.viewMode as any) ?? prev.viewMode,
              autoUploadGyazo: cloudData.autoUploadGyazo ?? prev.autoUploadGyazo,
              pureReplyMode: cloudData.pureReplyMode ?? prev.pureReplyMode
            };
          });

          // 注意：API 密钥在 UploadPanel 组件管理，这里只能恢复语言设置
          // API 密钥的云端同步需要在 UploadPanel 组件中实现

          // 恢复语言设置
          if (cloudData.settings?.language) {
            setLanguage(cloudData.settings.language as 'zh' | 'en');
          }

          console.log('[Email Sync] Merged cloud data with local state');
        }
        setEmailSyncStatus('success');
      } catch (error) {
        console.error('[Email Sync] Initial pull failed:', error);
        setEmailSyncStatus('error');
      }
    };

    initPull();
  }, []); // 只在组件挂载时执行一次
  // =============================================================

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const flushAll = () => {
      flushPendingSaves().catch((error) => {
        console.warn('[Project] Flush pending saves failed:', error);
      });
      flushPendingSync().catch((error) => {
        console.warn('[CloudSync] Flush pending sync failed:', error);
      });
    };

    const handleBeforeUnload = () => flushAll();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAll();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // ==================== 模板 & 预设云端同步 ====================
  // 模板数据云端同步 - 加载
  const templateCloudLoadedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!user || templateCloudLoadedRef.current) return;

    const loadCloudTemplates = async () => {
      try {
        const cloudTemplates = await loadTemplates(user.uid);
        if (cloudTemplates && cloudTemplates.savedTemplates) {
          templateCloudLoadedRef.current = true;
          setTemplateBuilderState(prev => ({
            ...prev,
            savedTemplates: cloudTemplates.savedTemplates,
            activeVersionId: cloudTemplates.activeVersionId || prev.activeVersionId
          }));
          console.log('[Cloud Sync] Loaded templates from Firestore:', cloudTemplates.savedTemplates.length);
        }
      } catch (error) {
        console.error('[Cloud Sync] Failed to load templates:', error);
      }
    };

    loadCloudTemplates();
  }, [user?.uid]);

  // 模板数据云端同步 - 保存 (防抖)
  const saveTemplatesTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!user || !templateCloudLoadedRef.current) return;

    if (saveTemplatesTimeoutRef.current) {
      clearTimeout(saveTemplatesTimeoutRef.current);
    }

    saveTemplatesTimeoutRef.current = setTimeout(async () => {
      try {
        await saveTemplates(user.uid, {
          savedTemplates: templateBuilderState.savedTemplates,
          activeVersionId: templateBuilderState.activeVersionId
        });
        console.log('[Cloud Sync] Templates saved to Firestore');
      } catch (error) {
        console.error('[Cloud Sync] Failed to save templates:', error);
      }
    }, 3000);

    return () => {
      if (saveTemplatesTimeoutRef.current) {
        clearTimeout(saveTemplatesTimeoutRef.current);
      }
    };
  }, [user?.uid, templateBuilderState.savedTemplates, templateBuilderState.activeVersionId]);

  // 图片工坊预设云端同步 - 加载
  const presetsCloudLoadedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!user || presetsCloudLoadedRef.current) return;

    const loadCloudPresets = async () => {
      try {
        const cloudPresets = await loadPresets(user.uid, 'imageStudio');
        if (cloudPresets && cloudPresets.categories) {
          presetsCloudLoadedRef.current = true;
          setImageStudioState(prev => ({
            ...prev,
            categories: cloudPresets.categories,
            customPrompts: cloudPresets.customPrompts || prev.customPrompts,
            nextPresetId: cloudPresets.nextPresetId || prev.nextPresetId,
            nextCategoryId: cloudPresets.nextCategoryId || prev.nextCategoryId
          }));
          console.log('[Cloud Sync] Loaded presets from Firestore');
        }
      } catch (error) {
        console.error('[Cloud Sync] Failed to load presets:', error);
      }
    };

    loadCloudPresets();
  }, [user?.uid]);

  // 图片工坊预设云端同步 - 保存 (防抖)
  const savePresetsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!user || !presetsCloudLoadedRef.current) return;

    if (savePresetsTimeoutRef.current) {
      clearTimeout(savePresetsTimeoutRef.current);
    }

    savePresetsTimeoutRef.current = setTimeout(async () => {
      try {
        await savePresets(user.uid, 'imageStudio', {
          categories: imageStudioState.categories,
          customPrompts: imageStudioState.customPrompts,
          nextPresetId: imageStudioState.nextPresetId,
          nextCategoryId: imageStudioState.nextCategoryId
        });
        console.log('[Cloud Sync] Presets saved to Firestore');
      } catch (error) {
        console.error('[Cloud Sync] Failed to save presets:', error);
      }
    }, 3000);

    return () => {
      if (savePresetsTimeoutRef.current) {
        clearTimeout(savePresetsTimeoutRef.current);
      }
    };
  }, [user?.uid, imageStudioState.categories, imageStudioState.customPrompts]);

  // 图片识别预设云端同步 - 加载
  const recognitionPresetsCloudLoadedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!user || recognitionPresetsCloudLoadedRef.current) return;

    const loadCloudRecognitionPresets = async () => {
      try {
        const { loadRecognitionPresetsFromCloud } = await import('@/apps/sheetmind/services/firebaseService');
        const cloudPresets = await loadRecognitionPresetsFromCloud();
        if (cloudPresets && cloudPresets.length > 0) {
          recognitionPresetsCloudLoadedRef.current = true;
          setImageRecognitionState(prev => ({
            ...prev,
            presets: cloudPresets.map(p => ({ id: p.id, name: p.name, text: p.text }))
          }));
          console.log('[Cloud Sync] Loaded recognition presets from Firestore:', cloudPresets.length);
        }
      } catch (error) {
        console.error('[Cloud Sync] Failed to load recognition presets:', error);
      }
    };

    loadCloudRecognitionPresets();
  }, [user?.uid]);

  // 图片识别预设云端同步 - 保存 (防抖)
  const saveRecognitionPresetsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!user || !recognitionPresetsCloudLoadedRef.current) return;

    if (saveRecognitionPresetsTimeoutRef.current) {
      clearTimeout(saveRecognitionPresetsTimeoutRef.current);
    }

    saveRecognitionPresetsTimeoutRef.current = setTimeout(async () => {
      try {
        const { saveRecognitionPresetsToCloud } = await import('@/apps/sheetmind/services/firebaseService');
        await saveRecognitionPresetsToCloud(
          imageRecognitionState.presets.map(p => ({
            id: p.id,
            name: p.name,
            text: p.text,
            createdAt: Date.now()
          }))
        );
        console.log('[Cloud Sync] Recognition presets saved to Firestore');
      } catch (error) {
        console.error('[Cloud Sync] Failed to save recognition presets:', error);
      }
    }, 3000);

    return () => {
      if (saveRecognitionPresetsTimeoutRef.current) {
        clearTimeout(saveRecognitionPresetsTimeoutRef.current);
      }
    };
  }, [user?.uid, imageRecognitionState.presets]);
  // ============================================================
  const registerImageSaveHandler = useCallback((handler: (() => void) | null) => {
    imageSaveHandlerRef.current = handler;
    setIsImageSaveReady(!!handler);
  }, []);

  const registerMagicSaveHandler = useCallback((handler: (() => void) | null) => {
    magicSaveHandlerRef.current = handler;
    setIsMagicSaveReady(!!handler);
  }, []);

  const registerTemplateSaveHandler = useCallback((handler: (() => void) | null) => {
    templateSaveHandlerRef.current = handler;
    setIsTemplateSaveReady(!!handler);
  }, []);

  const handleImageSaveStatusChange = useCallback((status: PresetSaveStatus | null) => {
    setImageSaveStatus(status);
  }, []);

  const handleMagicSaveStatusChange = useCallback((status: PresetSaveStatus | null) => {
    setMagicSaveStatus(status);
  }, []);

  const handleTemplateSaveStatusChange = useCallback((status: PresetSaveStatus | null) => {
    setTemplateSaveStatus(status);
  }, []);

  const triggerActivePresetSave = useCallback(() => {
    const handler =
      activeTool === 'studio'
        ? imageSaveHandlerRef.current
        : activeTool === 'magicCanvas'
          ? magicSaveHandlerRef.current
          : activeTool === 'template'
            ? templateSaveHandlerRef.current
            : null;
    handler?.();
  }, [activeTool]);

  useEffect(() => {
    // On initial load, if no key is set, show the modal.
    if (!isKeySet) {
      setShowApiKeyModal(true);
    }
  }, [isKeySet]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('app_text_model', textModel);
    } catch (e) {
      console.warn('Failed to persist model selection', e);
    }
  }, [textModel]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('app_image_model', imageModel);
    } catch (e) {
      console.warn('Failed to persist image model selection', e);
    }
  }, [imageModel]);

  const updatePromptState = (updater: any) => setPromptState(prev => {
    const partialUpdate = typeof updater === 'function' ? updater(prev) : updater;
    if (partialUpdate.activeSessionId === null && prev.activeSessionId !== null) {
      partialUpdate.activeImageId = null;
      partialUpdate.userInput = {};
    }
    return { ...prev, ...partialUpdate };
  });

  const updateImageStudioState = (updater: any) => setImageStudioState(prev => ({ ...prev, ...(typeof updater === 'function' ? updater(prev) : updater) }));

  const applyImportedImageStudio = (incoming: any) => {
    if (!incoming || !incoming.categories) return;
    setImageStudioState(prev => {
      const categories = cloneCategories(incoming.categories);
      const customPrompts = ensureCustomPromptMap(categories, incoming.customPrompts || {});
      const activeTab = categories.some(c => c.id === prev.activeTab) ? prev.activeTab : (categories[0]?.id || prev.activeTab);
      return {
        ...prev,
        categories,
        customPrompts,
        nextPresetId: incoming.nextPresetId || prev.nextPresetId,
        nextCategoryId: incoming.nextCategoryId || prev.nextCategoryId,
        activeTab
      };
    });
    setPresetNotice(t('presetSyncSuccess', { count: (incoming.categories || []).flatMap((c: any) => c.presets || []).length || 0 }));
  };

  const handleGlobalExportPresets = () => {
    const payload = {
      imageStudio: {
        categories: imageStudioState.categories,
        customPrompts: imageStudioState.customPrompts,
        nextPresetId: imageStudioState.nextPresetId,
        nextCategoryId: imageStudioState.nextCategoryId,
      },
      presetUser,
      exportedAt: new Date().toISOString()
    };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
    const link = document.createElement('a');
    link.href = jsonString;
    link.download = 'app-presets.json';
    link.click();
  };

  const handleGlobalImportPresets = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        if (parsed.imageStudio) {
          applyImportedImageStudio(parsed.imageStudio);
        } else {
          applyImportedImageStudio(parsed);
        }
      } catch (err) {
        console.error('Failed to import presets', err);
        alert('导入失败，文件格式可能不正确。');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const renderTool = () => {
    switch (activeTool) {
      case 'prompt':
        // Rendered outside of renderTool to keep mounted and preserve state
        return null;
      case 'translate':
        return (
          <SmartTranslateApp
            mode="embedded"
            getAiInstance={getAiInstance}
            language={language}
            setLanguage={setLanguage}
            theme={theme}
            toggleTheme={toggleTheme}
            textModel={textModel}
            state={smartTranslateState}
            setState={setSmartTranslateState}
          />
        );
      case 'subemail':
        return <SubEmailGenerator />;
      case 'template':
        return (
          <TemplateBuilderTool
            state={templateBuilderState}
            setState={setTemplateBuilderState}
            presetUser={presetUser}
            registerSaveHandler={registerTemplateSaveHandler}
            onSaveStatusChange={handleTemplateSaveStatusChange}
          />
        );
      case 'studio':
        return (
          <ImageStudioTool
            state={imageStudioState}
            setState={updateImageStudioState as any}
            presetUser={presetUser}
            registerSaveHandler={registerImageSaveHandler}
            onSaveStatusChange={handleImageSaveStatusChange}
            imageModel={imageModel}
            imageResolution={imageResolution}
            onEditInMagicCanvas={(file) => {
              setImageToEdit(file);
              setActiveTool('magicCanvas');
            }}
          />
        );
      case 'script':
        return <ScriptToolApp />;
      case 'aiToolsDirectory':
        return <AIToolsDirectoryApp getAiInstance={getAiInstance} textModel={textModel} currentUser={user} />;
      case 'magicCanvas':
        return (
          <AIImageEditorApp
            presetUser={presetUser}
            registerSaveHandler={magicSaveHandlerRef.current}
            onSaveStatusChange={handleMagicSaveStatusChange}
            textModel={textModel}
            imageModel={imageModel}
            imageResolution={imageResolution}
            initialImage={imageToEdit}
            state={magicCanvasState}
            setState={setMagicCanvasState}
          />
        );
      case 'imageRecognition':
        return (
          <div className="tool-container" style={{ padding: 0, overflow: 'hidden' }}>
            <ImageRecognitionApp
              getAiInstance={getAiInstance}
              state={imageRecognitionState}
              setState={setImageRecognitionState}
              onRotateApiKey={rotateApiKey}
              descState={descState}
              setDescState={setDescState}
              onNavigateToDesc={() => setActiveTool('desc')}
              onSendToDescInnovation={(prompts: string[]) => {
                // 创建创新 entries
                const entries = prompts.map(text => createDescEntry(text.trim()));
                // 设置状态并触发自动生成
                setDescState(prev => ({
                  ...prev,
                  entries: entries.length ? entries : [createDescEntry()],
                  bulkInput: '',
                  error: null,
                  controlNotice: null,
                  isProcessing: false,
                  isPaused: false,
                  pendingAutoGenerate: true, // 这会触发自动生成
                  shouldPlayCompletionSound: true,
                }));
              }}
              templateState={templateBuilderState}
              unifiedPresets={DEFAULT_RECOGNITION_PRESETS}
            />
          </div>
        );
      case 'sheetMind':
        // Rendered outside of renderTool to keep mounted
        return null;
      case 'mindMap':
        // Rendered outside of renderTool to keep mounted and preserve state
        return null;
      default:
        return null;
    }
  };

  useEffect(() => {
    document.title = t('appTitle');
  }, [t]);

  // 已废弃：不再自动同步指令模版到描述词创新
  // 因为描述词创新现在有独立的模版选择器
  // useEffect(() => {
  //   setDescState(prev => (prev.descPrompt === combinedTemplateInstruction ? prev : { ...prev, descPrompt: combinedTemplateInstruction }));
  // }, [combinedTemplateInstruction]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(TEMPLATE_BUILDER_STORAGE_KEY, JSON.stringify(templateBuilderState));
    } catch (err) {
      console.warn('Failed to save template builder state:', err);
    }
  }, [templateBuilderState]);

  const trimmedPresetUser = presetUser.trim();
  const presetUserIsValid = !!trimmedPresetUser && isValidPresetUser(trimmedPresetUser);
  const canSaveImagePresets = presetUserIsValid && isImageSaveReady && activeTool === 'studio';
  const canSaveMagicPresets = presetUserIsValid && isMagicSaveReady && activeTool === 'magicCanvas';
  const canSaveTemplatePresets = presetUserIsValid && isTemplateSaveReady && activeTool === 'template';
  let activeSaveLabel: string | null = null;
  let activeSaveStatus: PresetSaveStatus | null = null;
  let canSaveCurrentPresets = false;

  if (activeTool === 'studio') {
    activeSaveLabel = t('presetSaveStudio');
    activeSaveStatus = imageSaveStatus;
    canSaveCurrentPresets = canSaveImagePresets;
  } else if (activeTool === 'magicCanvas') {
    activeSaveLabel = t('presetSaveMagic');
    activeSaveStatus = magicSaveStatus;
    canSaveCurrentPresets = canSaveMagicPresets;
  } else if (activeTool === 'template') {
    activeSaveLabel = t('presetSaveTemplate');
    activeSaveStatus = templateSaveStatus;
    canSaveCurrentPresets = canSaveTemplatePresets;
  }

  return (
    <>
      {showApiKeyModal && <ApiKeyModal onClose={() => setShowApiKeyModal(false)} />}
      {showFeedbackModal && (
        <FeedbackModal
          onClose={() => setShowFeedbackModal(false)}
          userEmail={presetUser}
        />
      )}

      {/* 📖 帮助中心 */}
      <HelpCenter
        isOpen={showHelpCenter}
        onClose={() => setShowHelpCenter(false)}
      />

      {/* 教程模态窗口 */}
      {showTutorialModal && (
        <TutorialModal
          onClose={() => setShowTutorialModal(false)}
          language={language}
        />
      )}

      {/* 登录模态窗口 */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        language={language}
      />

      {/* 版本切换提示框 - 放在顶层确保可见 */}
      {showEditionTooltip && (
        <>
          {/* 点击外部关闭 */}
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}
            onClick={() => setShowEditionTooltip(false)}
          />
          <div
            className="edition-tooltip-global"
            style={{
              position: 'fixed',
              top: editionTooltipPos.top,
              left: editionTooltipPos.left,
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--surface-color, #1e1e1e)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1rem',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
              zIndex: 10001,
              width: '300px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: '0.75rem', fontWeight: 600, color: 'var(--on-surface-color)' }}>
              选择版本
            </div>

            {/* 网站版 */}
            <div
              onClick={() => {
                setShowEditionTooltip(false);
                // 如果当前不在网站版，则打开网站版
                if (appEdition !== 'website') {
                  window.open('https://ai-toolkit-b2b78.web.app/', '_blank');
                }
              }}
              style={{
                padding: '0.75rem',
                borderRadius: '8px',
                marginBottom: '0.5rem',
                cursor: 'pointer',
                backgroundColor: appEdition === 'website' ? 'rgba(33, 150, 243, 0.1)' : 'var(--background-color)',
                border: appEdition === 'website' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Globe size={16} className="text-blue-400" />
                <span style={{ fontWeight: 600, color: 'var(--on-surface-color)' }}>网站版</span>
                {appEdition === 'website' && <span style={{ color: 'var(--primary-color)', fontSize: '0.7rem' }}>当前</span>}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted-color)', lineHeight: 1.6 }}>
                ✓ <strong>API Key 自动轮换</strong><br />
                ✗ 不支持 AI 一键修图、AI 图片编辑
              </div>
            </div>

            {/* AI Studio版 */}
            <div
              onClick={() => {
                setShowEditionTooltip(false);
                // 如果当前不在 AI Studio 版，则打开 AI Studio 版
                if (appEdition !== 'aistudio') {
                  window.open('https://aistudio.google.com/apps/drive/1-sEKjY-VGi-kyKe_UXbUXEhbNRknxRBf?fullscreenApplet=true&showPreview=true&showAssistant=true', '_blank');
                }
              }}
              style={{
                padding: '0.75rem',
                borderRadius: '8px',
                marginBottom: '0.75rem',
                cursor: 'pointer',
                backgroundColor: appEdition === 'aistudio' ? 'rgba(103, 126, 234, 0.1)' : 'var(--background-color)',
                border: appEdition === 'aistudio' ? '2px solid #667eea' : '1px solid var(--border-color)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Bot size={16} className="text-purple-400" />
                <span style={{ fontWeight: 600, color: 'var(--on-surface-color)' }}>AI Studio版</span>
                {appEdition === 'aistudio' && <span style={{ color: '#667eea', fontSize: '0.7rem' }}>当前</span>}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted-color)', lineHeight: 1.6 }}>
                ✓ <strong>AI 一键修图</strong>、AI 图片编辑<br />
                ✗ 不支持 API 自动轮换
              </div>
            </div>

            {/* 共同功能说明 */}
            <div style={{
              padding: '0.6rem',
              borderRadius: '6px',
              backgroundColor: 'rgba(76, 175, 80, 0.08)',
              fontSize: '0.7rem',
              color: 'var(--text-muted-color)',
              lineHeight: 1.8,
              marginBottom: '0.75rem'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.4rem', color: 'var(--on-surface-color)' }}>
                <ClipboardList size={12} className="inline mr-1" /> AI图片识别 · 提示词工具 · 智能翻译
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted-color)', marginBottom: '0.3rem' }}>
                三大功能区共同支持：
              </div>
              ✓ 项目历史管理<br />
              ✓ 两个版本记录自动同步<br />
              <Lightbulb size={12} className="inline mr-1" /> 登录账号邮箱即可保存及同步记录
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={() => setShowEditionTooltip(false)}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'transparent',
                color: 'var(--text-muted-color)',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              关闭
            </button>
          </div>
        </>
      )}

      {/* 邮箱云同步面板 */}
      {showCloudSyncPanel && (
        <CloudSyncPanel
          onClose={() => setShowCloudSyncPanel(false)}
          images={imageRecognitionState.images}
          onImagesUpdate={(newImages) => {
            setImageRecognitionState(prev => ({ ...prev, images: newImages }));
          }}
          onSyncStatusChange={setEmailSyncStatus}
          onShowLogin={() => setShowLoginModal(true)}
        />
      )}

      {/* 更新通知 */}
      {showUpdateNotice && (
        <UpdateNotice
          onClose={() => setShowUpdateNotice(false)}
          language={language}
        />
      )}

      {/* Header 切换按钮 - 可隐藏 */}
      {hideToolbar ? (
        <button
          onClick={() => {
            setHideToolbar(false);
            localStorage.setItem('hide_global_toolbar', 'false');
          }}
          style={{
            position: 'fixed',
            top: '4px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            padding: '2px 12px',
            fontSize: '10px',
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            border: 'none',
            borderRadius: '0 0 6px 6px',
            cursor: 'pointer',
            opacity: 0.3,
            transition: 'opacity 0.2s'
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.3')}
          title="显示工具栏"
        >
          ▼ 显示工具栏
        </button>
      ) : (
        <div className="header-toggle-container">
          {/* 左侧：展开/收起按钮 */}
          <button
            className="header-toggle-btn"
            onClick={() => setIsPresetControlsExpanded(!isPresetControlsExpanded)}
            aria-label={isPresetControlsExpanded ? "收起功能菜单" : "展开功能菜单"}
            title={isPresetControlsExpanded ? "收起功能菜单" : "展开功能菜单"}
          >
            <span className="hand-icon" style={{ transform: isPresetControlsExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.3s ease' }}>👉</span>
          </button>

          {/* 折叠时显示的快捷工具栏 */}
          {!isPresetControlsExpanded && (
            <div className="collapsed-toolbar">
              {/* 导航图标 */}
              <nav className="collapsed-nav">
                {NAV_ITEMS.map(item => (
                  <button
                    key={item.tool}
                    onClick={() => setActiveTool(item.tool)}
                    className={`collapsed-nav-btn ${activeTool === item.tool ? 'active' : ''}`}
                    title={t(item.labelKey)}
                  >
                    <span className={`material-icons nav-icon-${item.tool}`}>{NAV_ICON_NAMES[item.tool]}</span>
                  </button>
                ))}
              </nav>

              {/* 分隔线 */}
              <div className="collapsed-divider" />

              {/* API 状态指示 */}
              <button
                onClick={() => setShowApiKeyModal(true)}
                className={`collapsed-api-btn ${isKeySet ? (usePool ? 'pool' : 'manual') : 'not-set'}`}
                title={
                  usePool && apiPoolStatus
                    ? `API池模式 (${apiPoolStatus.current}/${apiPoolStatus.total})`
                    : apiKey
                      ? `手动密钥: ${apiKey.substring(0, 6)}...`
                      : '点击设置API密钥'
                }
              >
                {usePool ? <RefreshCw size={14} /> : isKeySet ? <Key size={14} /> : <AlertTriangle size={14} />}
                {usePool && apiPoolStatus && (
                  <span className="api-pool-count">{apiPoolStatus.current}/{apiPoolStatus.total}</span>
                )}
              </button>

              {/* 分隔线 */}
              <div className="collapsed-divider" />

              {/* 用户账号按钮 - 点击打开登录/账号弹窗 */}
              <button
                onClick={() => setShowLoginModal(true)}
                className={`collapsed-login-btn ${user ? 'logged-in' : ''}`}
                title={user ? (user.email || '账号设置') : (language === 'zh' ? '登录' : 'Login')}
                style={{ padding: user?.photoURL ? '2px' : undefined }}
              >
                {user ? (
                  user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt="avatar"
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        objectFit: 'cover'
                      }}
                    />
                  ) : (
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: 'var(--primary-color)',
                      color: 'white',
                      fontSize: '0.75rem',
                      fontWeight: 600
                    }}>
                      {user.email?.charAt(0).toUpperCase() || '?'}
                    </span>
                  )
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                )}
              </button>

              {/* 版本切换按钮 */}
              <div style={{ position: 'relative' }}>
                <button
                  ref={editionBtnRef}
                  onClick={() => {
                    if (editionBtnRef.current) {
                      const rect = editionBtnRef.current.getBoundingClientRect();
                      setEditionTooltipPos({
                        top: rect.bottom + 8,
                        left: rect.left + rect.width / 2
                      });
                    }
                    setShowEditionTooltip(!showEditionTooltip);
                  }}
                  className={`collapsed-edition-btn ${appEdition}`}
                  title={appEdition === 'website' ? '网站版' : 'AI Studio版'}
                  style={{
                    padding: '0.3rem 0.5rem',
                    fontSize: '0.7rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: appEdition === 'aistudio' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'var(--surface-color)',
                    color: appEdition === 'aistudio' ? 'white' : 'var(--on-surface-color)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.2rem'
                  }}
                >
                  {appEdition === 'website' ? <Globe size={14} /> : <Bot size={14} />}
                  <span>{appEdition === 'website' ? 'Web' : 'AI'}</span>
                </button>
              </div>

              {/* 分隔线 */}
              <div className="collapsed-divider" />

              {/* 📖 帮助按钮 */}
              <button
                onClick={() => setShowHelpCenter(true)}
                className="collapsed-settings-btn"
                title={language === 'zh' ? '帮助中心' : 'Help Center'}
                style={{ fontSize: '16px' }}
              >
                <HelpCircle size={16} />
              </button>

              {/* 设置按钮 - 弹出设置面板 */}
              <div style={{ position: 'relative' }}>
                <button
                  ref={settingsBtnRef}
                  onClick={() => {
                    if (!showSettingsPanel && settingsBtnRef.current) {
                      const rect = settingsBtnRef.current.getBoundingClientRect();
                      setSettingsPanelPos({
                        top: rect.bottom + 8,
                        left: rect.left + rect.width / 2
                      });
                    }
                    setShowSettingsPanel(!showSettingsPanel);
                  }}
                  className="collapsed-settings-btn"
                  title={language === 'zh' ? '设置 (模型/缩放)' : 'Settings (Model/Scale)'}
                >
                  <Settings size={16} />
                </button>

                {/* 设置面板下拉菜单 - 使用 fixed 定位避免被裁切 */}
                {showSettingsPanel && (
                  <>
                    {/* 点击外部关闭 */}
                    <div
                      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
                      onClick={() => setShowSettingsPanel(false)}
                    />
                    <div className="settings-panel-dropdown" style={{
                      position: 'fixed',
                      top: settingsPanelPos.top,
                      left: settingsPanelPos.left,
                      transform: 'translateX(-50%)',
                      backgroundColor: 'var(--surface-color, #1e1e1e)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '1rem',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                      zIndex: 1000,
                      minWidth: '280px'
                    }}>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                          {language === 'zh' ? '文本模型' : 'Text Model'}
                        </label>
                        <select
                          value={textModel}
                          onChange={(e) => setTextModel(e.target.value)}
                          className="collapsed-select"
                          style={{ width: '100%' }}
                        >
                          {TEXT_MODEL_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                          {language === 'zh' ? '图片模型' : 'Image Model'}
                        </label>
                        <select
                          value={imageModel}
                          onChange={(e) => setImageModel(e.target.value)}
                          className="collapsed-select"
                          style={{ width: '100%' }}
                        >
                          {IMAGE_MODEL_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                          {language === 'zh' ? '图片分辨率' : 'Image Resolution'}
                        </label>
                        <select
                          value={imageResolution}
                          onChange={(e) => setImageResolution(e.target.value)}
                          className="collapsed-select"
                          style={{ width: '100%' }}
                        >
                          {IMAGE_RESOLUTION_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                          {language === 'zh' ? '界面缩放' : 'UI Scale'}
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <select
                            value={UI_SCALE_OPTIONS.includes(uiScale) ? uiScale : 'custom'}
                            onChange={(e) => {
                              if (e.target.value !== 'custom') {
                                setUiScale(parseInt(e.target.value, 10));
                              }
                            }}
                            className="collapsed-scale-select"
                            style={{ flex: 1 }}
                          >
                            {UI_SCALE_OPTIONS.map(v => (
                              <option key={v} value={v}>{v}%</option>
                            ))}
                            {!UI_SCALE_OPTIONS.includes(uiScale) && (
                              <option value="custom">{uiScale}%</option>
                            )}
                          </select>
                          <button className="collapsed-step-btn" onClick={() => setUiScale(Math.max(50, uiScale - 1))} title="-1%">−</button>
                          <button className="collapsed-step-btn" onClick={() => setUiScale(Math.min(400, uiScale + 1))} title="+1%">+</button>
                        </div>
                      </div>
                      <div style={{ marginTop: '0.75rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                          {language === 'zh' ? '文字大小' : 'Font Size'}
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <select
                            value={FONT_SCALE_OPTIONS.includes(fontScale) ? fontScale : 'custom'}
                            onChange={(e) => {
                              if (e.target.value !== 'custom') {
                                setFontScale(parseInt(e.target.value, 10));
                              }
                            }}
                            className="collapsed-scale-select"
                            style={{ flex: 1 }}
                          >
                            {FONT_SCALE_OPTIONS.map(v => (
                              <option key={v} value={v}>{v}%</option>
                            ))}
                            {!FONT_SCALE_OPTIONS.includes(fontScale) && (
                              <option value="custom">{fontScale}%</option>
                            )}
                          </select>
                          <button className="collapsed-step-btn" onClick={() => setFontScale(Math.max(50, fontScale - 1))} title="-1%">−</button>
                          <button className="collapsed-step-btn" onClick={() => setFontScale(Math.min(200, fontScale + 1))} title="+1%">+</button>
                        </div>
                      </div>

                      {/* 版本切换区域 */}
                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                          {language === 'zh' ? '🔄 版本切换' : '🔄 Version Switch'}
                        </label>
                        <div style={{
                          backgroundColor: 'var(--card-background, #2a2a2a)',
                          borderRadius: '6px',
                          padding: '0.5rem',
                          fontSize: '0.8rem'
                        }}>
                          <div style={{ marginBottom: '0.5rem', color: 'var(--text-color)', fontWeight: 500 }}>
                            ✅ {language === 'zh' ? '当前版本' : 'Current'}: v2.6.9
                          </div>
                          <div style={{ color: 'var(--text-muted-color)', lineHeight: 1.6 }}>
                            <div style={{ marginBottom: '0.25rem' }}>
                              {language === 'zh' ? '历史版本：' : 'History:'}
                            </div>
                            <a
                              href="https://ai-toolkit-b2b78--v2-6-8-22v256no.web.app"
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: '#4dabff',
                                textDecoration: 'none',
                                display: 'block',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                marginBottom: '0.25rem',
                                backgroundColor: 'rgba(77, 171, 255, 0.1)'
                              }}
                            >
                              📦 v2.6.8 (12/30)
                            </a>
                            <a
                              href="https://ai-toolkit-b2b78--v2-5-1-2nti7xkx.web.app"
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: '#4dabff',
                                textDecoration: 'none',
                                display: 'block',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(77, 171, 255, 0.1)'
                              }}
                            >
                              📦 v2.5.1 (12/21)
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 分隔线 */}
              <div className="collapsed-divider" />

              {/* 隐藏按钮 */}
              <button
                onClick={() => {
                  setHideToolbar(true);
                  localStorage.setItem('hide_global_toolbar', 'true');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted-color)',
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  opacity: 0.5,
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
                title="隐藏工具栏"
              >
                ⏏
              </button>
            </div>
          )}

          {/* 展开时显示的文字 */}
          {isPresetControlsExpanded && (
            <span className="toggle-text">
              收起功能菜单
            </span>
          )}

          {/* 查看更新按钮 */}
          <button
            className="view-update-btn"
            onClick={() => setShowUpdateNotice(true)}
            title={language === 'zh' ? '查看最新更新' : 'View Updates'}
          >
            <span className="update-icon">🎉</span>
            <span className="update-text">
              {language === 'zh' ? '更新 (01/29)' : 'Updates (01/29)'}
            </span>
          </button>
        </div>
      )}

      {/* 整个 Header - 可折叠 */}
      <header className={isPresetControlsExpanded ? 'expanded' : 'collapsed'}>
        <div className="header-content">
          <div className="title-bar">
            <h1>🪄 {t('appTitle')}</h1>
            <div className="header-controls">
              <button
                onClick={() => setShowApiKeyModal(true)}
                className="secondary-btn api-key-btn"
                style={{
                  background: isKeySet
                    ? (usePool && apiPoolStatus ? '#4caf5020' : '#4dabff20')
                    : '#ff000020',
                  borderColor: isKeySet
                    ? (usePool && apiPoolStatus ? '#4caf50' : '#4dabff')
                    : '#ff0000'
                }}
                title={
                  usePool && apiPoolStatus
                    ? `使用API池自动轮换 (${apiPoolStatus.current}/${apiPoolStatus.total})`
                    : apiKey
                      ? `手动设置密钥: ${apiKey.substring(0, 10)}...${apiKey.slice(-4)}`
                      : '未设置API密钥'
                }
              >
                {usePool && apiPoolStatus ? (
                  <>
                    🔄 API池
                    <span style={{ marginLeft: '4px', fontSize: '0.85em', opacity: 0.8 }}>
                      ({apiPoolStatus.current}/{apiPoolStatus.total})
                    </span>
                  </>
                ) : apiKey ? (
                  <>
                    🔑 手动密钥
                    <span style={{ marginLeft: '4px', fontSize: '0.75em', fontFamily: 'monospace', opacity: 0.7 }}>
                      {apiKey.substring(0, 6)}...
                    </span>
                  </>
                ) : (
                  <>🔑 {t('apiKeyButtonLabel')}</>
                )}
              </button>
              <button
                onClick={() => setShowFeedbackModal(true)}
                className="secondary-btn feedback-btn"
                title="帮助我们改进产品，您的意见将收集到我们的公开建议表中"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"></path>
                  <path d="M12 8v6"></path>
                  <path d="M9 11h6"></path>
                </svg>
                <span className="feedback-text">建议反馈</span>
              </button>
              <button
                onClick={() => setShowHelpCenter(true)}
                className="secondary-btn tutorial-btn"
                title={language === 'zh' ? '查看帮助文档' : 'View help documentation'}
              >
                ❓ {language === 'zh' ? '帮助' : 'Help'}
              </button>
              <div className="language-selector model-selector">
                <label style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{language === 'zh' ? '文本模型' : 'Text Model'}</label>
                <select value={textModel} onChange={(e) => setTextModel(e.target.value)} style={{ marginLeft: '8px' }}>
                  {TEXT_MODEL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="language-selector model-selector">
                <label style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{language === 'zh' ? '图片模型' : 'Image Model'}</label>
                <select value={imageModel} onChange={(e) => setImageModel(e.target.value)} style={{ marginLeft: '8px' }}>
                  {IMAGE_MODEL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="language-selector">
                <button onClick={() => setLanguage('zh')} className={language === 'zh' ? 'active' : ''}>中</button>
                <button onClick={() => setLanguage('en')} className={language === 'en' ? 'active' : ''}>EN</button>
              </div>
              {/* 版本切换按钮 */}
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setEditionTooltipPos({
                    top: rect.bottom + 8,
                    left: rect.left + rect.width / 2
                  });
                  setShowEditionTooltip(!showEditionTooltip);
                }}
                className={`secondary-btn edition-btn ${appEdition}`}
                title={appEdition === 'website' ? '网站版 - 点击切换' : 'AI Studio版 - 点击切换'}
                style={{
                  padding: '0.3rem 0.6rem',
                  fontSize: '0.75rem',
                  background: appEdition === 'aistudio' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'var(--surface-color)',
                  color: appEdition === 'aistudio' ? 'white' : 'var(--on-surface-color)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}
              >
                {appEdition === 'website' ? <><Globe size={14} className="inline mr-1" /> Web</> : <><Bot size={14} className="inline mr-1" /> AI</>}
              </button>
              <button onClick={toggleTheme} className="theme-toggle" aria-label="Toggle theme">
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              {/* 用户登录按钮 */}
              {user ? (
                <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {/* 云端同步状态 */}
                  {cloudSyncStatus === 'syncing' && (
                    <span style={{ fontSize: '0.75rem', color: '#4dabff', animation: 'pulse 1s infinite' }} title={language === 'zh' ? '正在同步...' : 'Syncing...'}>
                      ☁️
                    </span>
                  )}
                  {cloudSyncStatus === 'loading' && (
                    <span style={{ fontSize: '0.75rem', color: '#ffd700' }} title={language === 'zh' ? '加载云端设置...' : 'Loading...'}>
                      ⏳
                    </span>
                  )}
                  <img
                    src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email || 'U')}&background=4dabff&color=fff&size=32`}
                    alt="avatar"
                    style={{ width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer' }}
                    title={`${user.email || ''}\n${language === 'zh' ? '点击退出登录' : 'Click to sign out'}`}
                    onClick={() => {
                      if (confirm(language === 'zh' ? '确定要退出登录吗？' : 'Sign out?')) {
                        signOut();
                      }
                    }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="secondary-btn"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                >
                  {language === 'zh' ? '登录' : 'Login'}
                </button>
              )}
            </div>
          </div>

          {/* 预设控制区 */}
          <div className="preset-controls-section">
            <div className="preset-inline-controls">
              {/* 缩放控制 */}
              <div className="scale-control" title={language === 'zh' ? '界面缩放' : 'UI Scale'}>
                <span className="scale-icon">🔍</span>
                <select
                  value={UI_SCALE_OPTIONS.includes(uiScale) ? uiScale : 'custom'}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') {
                      setUiScale(parseInt(e.target.value, 10));
                    }
                  }}
                  className="scale-select"
                >
                  {UI_SCALE_OPTIONS.map(v => (
                    <option key={v} value={v}>{v}%</option>
                  ))}
                  {!UI_SCALE_OPTIONS.includes(uiScale) && (
                    <option value="custom">{uiScale}%</option>
                  )}
                </select>
                <button
                  className="scale-step-btn"
                  onClick={() => setUiScale(Math.max(50, uiScale - 1))}
                  title="-1%"
                >
                  −
                </button>
                <button
                  className="scale-step-btn"
                  onClick={() => setUiScale(Math.min(400, uiScale + 1))}
                  title="+1%"
                >
                  +
                </button>
                <input
                  type="number"
                  min="50"
                  max="400"
                  value={uiScale}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 50 && val <= 400) {
                      setUiScale(val);
                    }
                  }}
                  className="scale-input"
                  title={language === 'zh' ? '手动输入缩放比例 (50-400)' : 'Manual input (50-400)'}
                />
                {uiScale !== 100 && (
                  <button
                    className="scale-reset"
                    onClick={() => setUiScale(100)}
                    title={language === 'zh' ? '重置缩放' : 'Reset'}
                  >
                    ↺
                  </button>
                )}
              </div>
              {/* 文字大小控制 */}
              <div className="scale-control" title={language === 'zh' ? '文字大小' : 'Font Size'}>
                <span className="scale-icon">🔤</span>
                <select
                  value={FONT_SCALE_OPTIONS.includes(fontScale) ? fontScale : 'custom'}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') {
                      setFontScale(parseInt(e.target.value, 10));
                    }
                  }}
                  className="scale-select"
                >
                  {FONT_SCALE_OPTIONS.map(v => (
                    <option key={v} value={v}>{v}%</option>
                  ))}
                  {!FONT_SCALE_OPTIONS.includes(fontScale) && (
                    <option value="custom">{fontScale}%</option>
                  )}
                </select>
                <button
                  className="scale-step-btn"
                  onClick={() => setFontScale(Math.max(50, fontScale - 1))}
                  title="-1%"
                >
                  −
                </button>
                <button
                  className="scale-step-btn"
                  onClick={() => setFontScale(Math.min(200, fontScale + 1))}
                  title="+1%"
                >
                  +
                </button>
                <input
                  type="number"
                  min="50"
                  max="200"
                  value={fontScale}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 50 && val <= 200) {
                      setFontScale(val);
                    }
                  }}
                  className="scale-input"
                  title={language === 'zh' ? '手动输入文字大小 (50-200)' : 'Manual input (50-200)'}
                />
                {fontScale !== 100 && (
                  <button
                    className="scale-reset"
                    onClick={() => setFontScale(100)}
                    title={language === 'zh' ? '重置文字大小' : 'Reset'}
                  >
                    ↺
                  </button>
                )}
              </div>
              {activeSaveLabel && (
                <>
                  <button
                    className="secondary-btn"
                    onClick={triggerActivePresetSave}
                    disabled={!canSaveCurrentPresets}
                  >
                    {activeSaveLabel}
                  </button>
                  {activeSaveStatus && (
                    <span className={`preset-status ${activeSaveStatus.type}`}>
                      {activeSaveStatus.message}
                    </span>
                  )}
                </>
              )}
              <button className="secondary-btn" onClick={() => presetImportRef.current?.click()}>{t('presetGlobalImport')}</button>
              <input type="file" ref={presetImportRef} style={{ display: 'none' }} accept=".json" onChange={handleGlobalImportPresets} />
              <button className="secondary-btn" onClick={handleGlobalExportPresets}>{t('presetGlobalExport')}</button>
              <span className="preset-warning-notice">⚠️ 注意：如果要添加预设或者编辑预设，关闭前或者编辑后一定要导出预设，或者填写邮箱账号实现云同步预设，否则下次打开将全部恢复默认。</span>
              {presetUser && !isValidPresetUser(presetUser) && <span className="preset-status error">{t('presetUserMustBeGmail')}</span>}

              {presetNotice && <span className="preset-status success">{presetNotice}</span>}
            </div>
          </div>

          <nav>
            {NAV_ITEMS.map(item => (
              <button
                key={item.tool}
                onClick={() => setActiveTool(item.tool)}
                className={activeTool === item.tool ? 'active' : ''}
              >
                <span aria-hidden="true" className="nav-icon material-icons">
                  {NAV_ICON_NAMES[item.tool]}
                </span>
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <DescChineseProvider entries={descState.entries} textModel={textModel}>
        <main>
          {renderTool()}
          {/* Image to Prompt stays mounted to preserve session state */}
          <div className={`image-to-prompt-page-wrapper ${activeTool === 'prompt' ? 'visible' : 'hidden'}`} style={{ overflow: 'auto', height: activeTool === 'prompt' ? '100%' : '0' }}>
            <ImageToPromptApp
              getAiInstance={getAiInstance}
              t={t}
              templateBuilderState={templateBuilderState}
              textModel={textModel}
            />
          </div>
          <div className={`desc-page-wrapper ${activeTool === 'desc' ? 'visible' : 'hidden'}`}>
            <PromptToolApp
              getAiInstance={getAiInstance}
              textModel={textModel}
              templateState={templateBuilderState}
              unifiedPresets={DEFAULT_RECOGNITION_PRESETS}
            />
          </div>
          {/* SheetMind stays mounted to preserve data state */}
          <div className={`sheetmind-page-wrapper ${activeTool === 'sheetMind' ? 'visible' : 'hidden'}`} style={{ padding: 0, overflow: 'hidden', height: activeTool === 'sheetMind' ? '100%' : '0' }}>
            <SheetMindApp
              getAiInstance={getAiInstance}
              state={sheetMindState}
              setState={setSheetMindState}
            />
          </div>
          {/* Copy Dedup stays mounted to preserve library state */}
          <div className={`copydedup-page-wrapper ${activeTool === 'copyDedup' ? 'visible' : 'hidden'}`} style={{ padding: '1rem', overflow: 'auto', height: activeTool === 'copyDedup' ? '100%' : '0' }}>
            <AICopyDeduplicatorApp getAiInstance={getAiInstance} textModel={textModel} />
          </div>
          {/* Pro Dedup - MinHash + LSH 文案相似度检查 */}
          <div className={`copydedup-page-wrapper ${activeTool === 'proDedup' ? 'visible' : 'hidden'}`} style={{ overflow: 'auto', height: activeTool === 'proDedup' ? '100%' : '0' }}>
            <ProDedupApp />
          </div>
          {/* AI Mind Map - Full-screen React Flow canvas */}
          <div className={`mindmap-page-wrapper ${activeTool === 'mindMap' ? 'visible' : 'hidden'}`} style={{ overflow: 'hidden', height: activeTool === 'mindMap' ? '100%' : '0' }}>
            <MindMapApp getAiInstance={getAiInstance} />
          </div>

        </main>
      </DescChineseProvider>

      {/* 版本号显示与选择器 */}
      <VersionSelector
        currentVersion={typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.6.10'}
        buildTime={typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''}
      />
    </>
  );
};

const Root = () => (
  <ErrorBoundary>
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <ApiProvider>
            <FixedTooltipProvider>
              <App />
            </FixedTooltipProvider>
          </ApiProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<Root />);
