/// <reference lib="webworker" />

import * as XLSX from 'xlsx';

type SheetData = {
    fileName: string;
    sheetName: string;
    sheetNames: string[];
    columns: string[];
    rows: Record<string, unknown>[];
};

type ParseRequest = {
    id: number;
    mode: 'single' | 'multi';
    fileName: string;
    sheetName?: string;
    sheetNames?: string[];
    sheet?: XLSX.WorkSheet;
    sheets?: Record<string, XLSX.WorkSheet>;
    allSheetNames: string[];
};

type ParseResponse = {
    id: number;
    result?: SheetData;
    error?: string;
};

const excelSerialToDate = (serial: number): string => {
    const excelEpoch = new Date(1899, 11, 30);
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const date = new Date(excelEpoch.getTime() + serial * millisecondsPerDay);

    const hasTime = serial % 1 !== 0;
    if (hasTime) {
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
};

const looksLikeExcelDate = (value: number): boolean => {
    return value >= 1 && value <= 60000 && !Number.isInteger(value * 10000);
};

const isLikelyImageUrl = (url: string): boolean => {
    if (!/^https?:\/\//i.test(url)) return false;

    const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i;
    if (imageExtensions.test(url)) return true;

    if (/googleusercontent\.com|drive\.google\.com/i.test(url)) return true;
    if (/gyazo\.com|imgur\.com|imgbb\.com|cloudinary\.com|unsplash\.com|pexels\.com|flickr\.com|pinterest\.com|instagram\.com/i.test(url)) return true;

    return false;
};

const extractImageFromFormula = (cellValue: string | number | boolean | null): string | null => {
    if (typeof cellValue !== 'string') return null;

    const strVal = cellValue.trim();

    const imageFormulaRegex = /^=IMAGE\s*\(\s*"([^"]+)"/i;
    const match = strVal.match(imageFormulaRegex);
    if (match) return match[1];

    const imageFormulaSingleQuoteRegex = /^=IMAGE\s*\(\s*'([^']+)'/i;
    const matchSingle = strVal.match(imageFormulaSingleQuoteRegex);
    if (matchSingle) return matchSingle[1];

    const imageFormulaUnquotedRegex = /^=IMAGE\s*\(\s*(https?:\/\/[^,\s)]+)/i;
    const matchUnquoted = strVal.match(imageFormulaUnquotedRegex);
    if (matchUnquoted) return matchUnquoted[1];

    const imageHyperlinkRegex = /^=IMAGE\s*\(\s*HYPERLINK\s*\(\s*"([^"]+)"/i;
    const matchImageHyperlink = strVal.match(imageHyperlinkRegex);
    if (matchImageHyperlink) return matchImageHyperlink[1];
    const imageHyperlinkSingleRegex = /^=IMAGE\s*\(\s*HYPERLINK\s*\(\s*'([^']+)'/i;
    const matchImageHyperlinkSingle = strVal.match(imageHyperlinkSingleRegex);
    if (matchImageHyperlinkSingle) return matchImageHyperlinkSingle[1];

    const hyperlinkRegex = /^=HYPERLINK\s*\(\s*"([^"]+)"/i;
    const hyperlinkMatch = strVal.match(hyperlinkRegex);
    if (hyperlinkMatch && isLikelyImageUrl(hyperlinkMatch[1])) return hyperlinkMatch[1];
    const hyperlinkSingleRegex = /^=HYPERLINK\s*\(\s*'([^']+)'/i;
    const hyperlinkMatchSingle = strVal.match(hyperlinkSingleRegex);
    if (hyperlinkMatchSingle && isLikelyImageUrl(hyperlinkMatchSingle[1])) return hyperlinkMatchSingle[1];

    const urlRegex = /^https?:\/\/.*\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i;
    if (urlRegex.test(strVal)) return strVal;

    return null;
};

const parseSheetFromWorkSheet = (
    sheet: XLSX.WorkSheet,
    sheetName: string,
    fileName: string,
    allSheetNames: string[]
): SheetData => {
    let headerRowIndex: number | null = null;
    const headerValues = new Map<number, string>();

    if (sheet['!ref']) {
        const range = XLSX.utils.decode_range(sheet['!ref']);
        headerRowIndex = range.s.r;

        // Build header map by scanning only existing cells in the header row
        for (const cellAddress of Object.keys(sheet)) {
            if (cellAddress.startsWith('!')) continue;
            const cell = sheet[cellAddress];
            if (!cell) continue;
            const decoded = XLSX.utils.decode_cell(cellAddress);
            if (decoded.r === headerRowIndex) {
                headerValues.set(decoded.c, String(cell.v ?? '').toLowerCase());
            }
        }
    }

    // Process only existing cells (skip empty grid space)
    for (const cellAddress of Object.keys(sheet)) {
        if (cellAddress.startsWith('!')) continue;
        const cell = sheet[cellAddress];
        if (!cell) continue;
        const decoded = XLSX.utils.decode_cell(cellAddress);

        if (cell.f) {
            const formulaText = '=' + cell.f;
            const imageUrl = extractImageFromFormula(formulaText);
            const isImageFormula = /^=IMAGE\s*\(/i.test(formulaText);
            const isImageHyperlink = /^=HYPERLINK\s*\(/i.test(formulaText);

            if (imageUrl && (isImageFormula || isImageHyperlink)) {
                cell.v = formulaText;
                cell.t = 's';
                if (cell.w) delete cell.w;
            }
        }

        if (cell.t === 'n' && typeof cell.v === 'number' && looksLikeExcelDate(cell.v)) {
            const headerValue = headerRowIndex !== null
                ? headerValues.get(decoded.c) || ''
                : '';
            const isDateColumn = /日期|date|time|时间|创建|更新|发布/.test(headerValue);

            if (isDateColumn || cell.z?.includes('yy') || cell.z?.includes('mm') || cell.z?.includes('dd')) {
                cell.w = excelSerialToDate(cell.v);
                cell.v = cell.w;
                cell.t = 's';
            }
        }
    }

    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rawData.length === 0) {
        return {
            fileName,
            sheetName,
            sheetNames: allSheetNames,
            columns: [],
            rows: []
        };
    }

    const firstRow = rawData[0] as Record<string, unknown>;
    const columns = Object.keys(firstRow);
    const rows = rawData as Record<string, unknown>[];

    return {
        fileName,
        sheetName,
        sheetNames: allSheetNames,
        columns,
        rows
    };
};

const parseMultipleSheetsFromMap = (
    sheets: Record<string, XLSX.WorkSheet>,
    sheetNames: string[],
    fileName: string,
    allSheetNames: string[]
): SheetData => {
    const allRows: Record<string, unknown>[] = [];
    const columnSet = new Set<string>();

    for (const sheetName of sheetNames) {
        const sheet = sheets[sheetName];
        if (!sheet) continue;
        try {
            const sheetData = parseSheetFromWorkSheet(sheet, sheetName, fileName, allSheetNames);
            sheetData.columns.forEach(col => columnSet.add(col));
        } catch (e) {
            // ignore
        }
    }

    for (const sheetName of sheetNames) {
        const sheet = sheets[sheetName];
        if (!sheet) continue;
        try {
            const sheetData = parseSheetFromWorkSheet(sheet, sheetName, fileName, allSheetNames);
            sheetData.rows.forEach(row => {
                allRows.push({
                    _sourceSheet: sheetName,
                    ...row
                });
            });
        } catch (e) {
            // ignore
        }
    }

    const columns = ['_sourceSheet', ...Array.from(columnSet)];

    return {
        fileName,
        sheetName: `合并 (${sheetNames.length}个分页)`,
        sheetNames: allSheetNames,
        columns,
        rows: allRows
    };
};

self.onmessage = (event: MessageEvent<ParseRequest>) => {
    const { id, mode, fileName, sheetName, sheetNames, sheet, sheets, allSheetNames } = event.data;

    try {
        let result: SheetData;
        if (mode === 'single') {
            if (!sheet || !sheetName) throw new Error('缺少工作表数据');
            result = parseSheetFromWorkSheet(sheet, sheetName, fileName, allSheetNames);
        } else {
            if (!sheets || !sheetNames) throw new Error('缺少多表数据');
            result = parseMultipleSheetsFromMap(sheets, sheetNames, fileName, allSheetNames);
        }

        const response: ParseResponse = { id, result };
        self.postMessage(response);
    } catch (err) {
        const message = err instanceof Error ? err.message : '解析失败';
        const response: ParseResponse = { id, error: message };
        self.postMessage(response);
    }
};
