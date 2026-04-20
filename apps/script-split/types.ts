
export type CellValue = string;
export type GridData = CellValue[][];

export enum ToolType {
  SplitThree = 'SPLIT_THREE',
  SplitTwo = 'SPLIT_TWO',
  CleanBreaks = 'CLEAN_BREAKS',
  VideoPrompts = 'VIDEO_PROMPTS',
  ClearChinese = 'CLEAR_CHINESE',  // 删除选中区域内的中文内容
  AddPromptPrefix = 'ADD_PROMPT_PREFIX',  // 给每个单元格添加 prompt-序号 前缀
  SmartSplit = 'SMART_SPLIT',  // 半智能拆分：优先换行 → 冒号 → 英文句号 → 关键词
  MultiPanelPrompt = 'MULTI_PANEL_PROMPT',  // 多画面提示词：将文案自动生成多画面分割图格式
  CleanTails = 'CLEAN_TAILS',  // 清理尾部水印标签
  CleanEmojis = 'CLEAN_EMOJIS', // 清理表情符号
  AutoWrap = 'AUTO_WRAP',  // 自动断行（英文单词不断开）
}

export interface Coordinate {
  row: number;
  col: number;
}

export interface GridSelection {
  start: Coordinate;
  end: Coordinate;
}


// Maps to the visual column headers (A, B, C...)
export const COL_HEADERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

// Options for grid processing
export interface ProcessOptions {
  clearSource?: boolean;  // 拆分后是否删除原始文案
  customPrefix?: string;  // 自定义前缀（用于 AddPromptPrefix 工具）
  lineWidth?: number; // 断行宽度（用于 AutoWrap 工具）
}

// Cell styling (for background colors)
export interface CellStyle {
  bgColor?: string;  // Background color (e.g., '#FFA500' for orange)
}

// Grid styles: Map<"row,col", CellStyle>
export type GridStyles = Map<string, CellStyle>;

// Helper to create cell key
export const cellKey = (row: number, col: number): string => `${row},${col}`;
