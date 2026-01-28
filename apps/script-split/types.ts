
export type CellValue = string;
export type GridData = CellValue[][];

export enum ToolType {
  SplitThree = 'SPLIT_THREE',
  SplitTwo = 'SPLIT_TWO',
  CleanBreaks = 'CLEAN_BREAKS',
  VideoPrompts = 'VIDEO_PROMPTS',
  ClearChinese = 'CLEAR_CHINESE',  // 删除选中区域内的中文内容
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
}

// Cell styling (for background colors)
export interface CellStyle {
  bgColor?: string;  // Background color (e.g., '#FFA500' for orange)
}

// Grid styles: Map<"row,col", CellStyle>
export type GridStyles = Map<string, CellStyle>;

// Helper to create cell key
export const cellKey = (row: number, col: number): string => `${row},${col}`;
