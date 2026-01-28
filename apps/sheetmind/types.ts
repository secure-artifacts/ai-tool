
// Data structures
export interface DataRow {
    [key: string]: string | number | boolean | null;
}

export interface SheetData {
    fileName: string;
    sheetName: string;      // Current sheet name
    sheetNames: string[];   // All available sheets
    columns: string[];
    rows: DataRow[];
}

export interface ChartDefinition {
    type: 'bar' | 'pie';
    data: { name: string; value: number }[];
    title: string;
    dataKey: string; // usually 'value'
    categoryKey: string; // usually 'name'
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    isError?: boolean;
    relatedChart?: ChartDefinition;
}

export enum AnalysisType {
    SUMMARY = 'SUMMARY',
    CATEGORIZATION = 'CATEGORIZATION',
    FORMULA_AUDIT = 'FORMULA_AUDIT',
    CUSTOM = 'CUSTOM'
}

// Dashboard Types
// Expanded operators to cover Text, Date, and Range scenarios
export type FilterOperator =
    | 'eq' | 'neq'
    | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
    | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
    | 'dateIs' | 'dateBefore' | 'dateAfter';

export interface FilterCondition {
    id: string;
    column: string;
    operator: FilterOperator;
    value: string;
    value2?: string; // Used for 'between' range queries
}

// Charts
export type ChartType = 'bar' | 'bar-horizontal' | 'line' | 'area' | 'pie' | 'radar' | 'scatter' | 'funnel' | 'treemap' | 'pivot';
export type AggregationType = 'count' | 'sum' | 'avg';

export interface ChartSnapshot {
    id: string;
    title: string;
    type: ChartType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any[];
    breakdownKeys: string[];
    aggregation: string;
    metricLabel: string;
    isStacked: boolean;
    xAxisLabel: string;
}

// App State for persistence
export interface SheetMindState {
    // Workbook and sheet data
    hasWorkbook: boolean;
    fileName: string;
    sourceUrl?: string;
    currentSheetName: string;
    // View state
    view: 'grid' | 'dashboard' | 'transpose' | 'gallery' | 'align';
    isSidebarOpen: boolean;
    sidebarTab: 'chat' | 'gallery';
    // Snapshots
    snapshots: ChartSnapshot[];
}

export const initialSheetMindState: SheetMindState = {
    hasWorkbook: false,
    fileName: '',
    sourceUrl: undefined,
    currentSheetName: '',
    view: 'grid',
    isSidebarOpen: false,
    sidebarTab: 'chat',
    snapshots: [],
};
