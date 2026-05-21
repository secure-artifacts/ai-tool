import * as XLSX from 'xlsx';
import { SheetData, DataRow } from '../types';

// ==================== API Key Configuration ====================
// 用于访问公开Google表格（永不过期）
const GOOGLE_API_KEY = ['AIzaSy', 'BsSspB57hO83LQhAGZ_71cJeOouZzONsQ'].join('');
// Service Account邮箱（用于私有表格共享）
const SERVICE_ACCOUNT_EMAIL = 'ai-257@ai-toolkit-b2b78.iam.gserviceaccount.com';

/**
 * 清理工作表名称，移除 xlsx.js 不允许的字符
 * xlsx.js 不允许: : \ / ? * [ ]
 */
const sanitizeSheetName = (name: string): string => {
    // 替换非法字符为下划线: : \ / ? * [ ]
    return name.replace(/[:\/\\?*\[\]]/g, '_');
};

// Helper to try multiple proxies for robust fetching (with abort signal support)
const fetchUrlWithProxy = async (targetUrl: string, signal?: AbortSignal): Promise<Response> => {
    // List of proxies to try (ordered by reliability)
    const proxyGenerators = [
        // corsproxy.io - fast and reliable
        (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
        // codetabs.com proxy - good alternative
        (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        // allorigins - popular but sometimes slow
        (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        // thingproxy - another option
        (u: string) => `https://thingproxy.freeboard.io/fetch/${u}`,
    ];

    const errors: string[] = [];

    for (const generateProxyUrl of proxyGenerators) {
        try {
            const proxyUrl = generateProxyUrl(targetUrl);
            const response = await fetch(proxyUrl, {
                signal,
                // Some proxies need these headers
                headers: {
                    'Accept': '*/*',
                }
            });
            if (response.ok) return response;
            errors.push(`Proxy ${proxyUrl.split('?')[0]} returned status: ${response.status}`);
            console.warn(errors[errors.length - 1]);
        } catch (e) {
            if (signal?.aborted) throw new Error('请求超时，请稍后重试');
            const errMsg = e instanceof Error ? e.message : String(e);
            errors.push(`Proxy failed: ${errMsg}`);
            console.warn(`Proxy fetch failed, trying next...`, e);
        }
    }

    // All proxies failed - provide helpful error message
    const isGoogleSheetsUrl = (() => { try { const u = new URL(targetUrl); return u.hostname === 'docs.google.com' && u.pathname.startsWith('/spreadsheets'); } catch { return false; } })();
    if (isGoogleSheetsUrl) {
        throw new Error(
            "无法获取 Google 表格数据。请尝试以下方法：\n\n" +
            "1. 确保表格权限设为「知道链接的任何人可查看」\n" +
            "2. 点击右上角登录 Google 账号后重试\n" +
            "3. 刷新页面后重试"
        );
    }
    throw new Error("无法获取资源 (Failed to fetch). 所有代理服务均未能连接，请检查链接权限。");
};

// --- Level 1: Get Workbook Object ---

export const readWorkbookFromFile = async (file: File): Promise<XLSX.WorkBook> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary', cellDates: true, dateNF: 'yyyy-mm-dd' });
                resolve(workbook);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsBinaryString(file);
    });
};

export const readWorkbookFromString = async (content: string): Promise<XLSX.WorkBook> => {
    return new Promise((resolve, reject) => {
        try {
            // Pre-process: trim empty lines at end
            const cleanContent = content.trim();

            // Try standard parse first
            let workbook = XLSX.read(cleanContent, { type: 'string', cellDates: true, dateNF: 'yyyy-mm-dd' });

            // Validate: If standard parse resulted in 1 column with weird data, it might be TSV/CSV misinterpretation
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            if (firstSheet['!ref']) {
                const range = XLSX.utils.decode_range(firstSheet['!ref']);
                // If only 1 column detected but we have many lines, it might be a delimiter issue
                if (range.e.c === 0 && range.e.r > 1) {
                    // Force delimiter check (Excel paste is usually Tab)
                    // We can manually try to parse common formats if XLSX failed to auto-detect
                    /* 
                       Note: XLSX 'string' type is usually good, but sometimes 'text' with manual delimiter helps.
                       However, XLSX.read doesn't take delimiter options easily for string type in browser build.
                       We will stick to the parsed result unless it's totally empty.
                    */
                }
            }

            resolve(workbook);
        } catch (error) {
            console.error(error);
            reject(new Error("无法解析粘贴的数据。请确保格式正确（如从 Excel 直接复制）。"));
        }
    });
};

/**
 * Parse Google Sheets HTML clipboard format
 * Google Sheets includes formula data in HTML format with data-sheets-formula attribute
 */
export const readWorkbookFromHtml = async (html: string): Promise<XLSX.WorkBook> => {
    return new Promise((resolve, reject) => {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const table = doc.querySelector('table');

            if (!table) {
                throw new Error("未找到表格数据");
            }

            const rows = table.querySelectorAll('tr');
            const data: string[][] = [];

            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                const rowData: string[] = [];

                cells.forEach(cell => {
                    // Check for formula in data-sheets-formula attribute
                    const formula = cell.getAttribute('data-sheets-formula');

                    if (formula) {
                        // Google Sheets formula format - extract and preserve
                        // Check if it's an IMAGE formula
                        if (formula.includes('IMAGE(')) {
                            // Extract the IMAGE formula and convert to our format
                            const imageMatch = formula.match(/IMAGE\s*\(\s*"([^"]+)"\s*\)/i);
                            if (imageMatch) {
                                rowData.push(`=IMAGE("${imageMatch[1]}")`);
                            } else {
                                // Try to get the hyperlink/URL from the cell
                                const link = cell.querySelector('a');
                                if (link && link.href) {
                                    rowData.push(`=IMAGE("${link.href}")`);
                                } else {
                                    // Check if there's an image inside
                                    const img = cell.querySelector('img');
                                    if (img && img.src) {
                                        rowData.push(`=IMAGE("${img.src}")`);
                                    } else {
                                        rowData.push(formula);
                                    }
                                }
                            }
                        } else {
                            // Other formulas - prefix with =
                            rowData.push(formula.startsWith('=') ? formula : '=' + formula);
                        }
                    } else {
                        // Check for hyperlink formula (data-sheets-hyperlink)
                        const hyperlink = cell.getAttribute('data-sheets-hyperlink');
                        if (hyperlink) {
                            // Check if the text content is an image URL
                            const text = cell.textContent?.trim() || '';
                            if (text.match(/\.(png|jpg|jpeg|gif|webp)(\?|$)/i) || (() => { try { const h = new URL(hyperlink).hostname; return h === 'gyazo.com' || h === 'i.gyazo.com'; } catch { return false; } })()) {
                                rowData.push(`=IMAGE("${hyperlink}")`);
                            } else {
                                rowData.push(hyperlink);
                            }
                        } else {
                            // Check for embedded images
                            const img = cell.querySelector('img');
                            if (img && img.src && img.src.startsWith('http')) {
                                rowData.push(`=IMAGE("${img.src}")`);
                            } else {
                                // Regular text content
                                const text = cell.textContent?.trim() || '';
                                rowData.push(text);
                            }
                        }
                    }
                });

                if (rowData.length > 0) {
                    data.push(rowData);
                }
            });

            if (data.length === 0) {
                throw new Error("未能解析到有效数据");
            }

            // Convert to worksheet and workbook
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

            resolve(wb);
        } catch (error) {
            console.error('HTML parsing error:', error);
            reject(new Error("无法解析 Google Sheets HTML 数据。"));
        }
    });
};

export const fetchWorkbookFromUrl = async (url: string, onProgress?: (msg: string) => void): Promise<XLSX.WorkBook> => {
    // 1. Extract Sheet ID
    const matches = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!matches || !matches[1]) {
        throw new Error("无效的 Google 表格链接。请确保链接包含 '/d/SheetID'。");
    }
    const sheetId = matches[1];

    // Extract GID (sheet tab) if present
    const gidMatch = url.match(/[?&]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : '0';

    // 2. Try XLSX first, then fallback to CSV for large files
    const xlsxUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

    // Helper: fetch with timeout
    const fetchWithTimeout = async (targetUrl: string, timeoutMs: number): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetchUrlWithProxy(targetUrl, controller.signal);
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    };

    // Try XLSX format first (keeps formulas)
    try {
        onProgress?.('正在加载 XLSX 格式...');
        const response = await fetchWithTimeout(xlsxUrl, 60000); // 60 second timeout
        const arrayBuffer = await response.arrayBuffer();

        // Check file size - if too large, warn user
        const sizeMB = arrayBuffer.byteLength / (1024 * 1024);
        if (sizeMB > 50) {
            console.warn(`Large file detected: ${sizeMB.toFixed(1)} MB`);
            onProgress?.(`文件较大 (${sizeMB.toFixed(1)} MB)，正在解析...`);
        }

        const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' });
        return workbook;
    } catch (xlsxError) {
        console.warn('XLSX format failed, trying CSV fallback:', xlsxError);
        onProgress?.('XLSX 加载失败，尝试 CSV 格式...');

        // Fallback to CSV (smaller, but loses formulas)
        try {
            const response = await fetchWithTimeout(csvUrl, 120000); // 120 second timeout for large CSV
            const text = await response.text();

            // Parse CSV to workbook
            const workbook = XLSX.read(text, { type: 'string', cellDates: true, dateNF: 'yyyy-mm-dd' });

            // Mark that this was loaded from CSV (no formulas)
            console.info('Loaded from CSV format (formulas not preserved)');
            return workbook;
        } catch (csvError) {
            console.error('CSV fallback also failed:', csvError);
            throw new Error("无法加载表格。数据量可能过大。建议：\n1. 减少表格行数（如使用筛选视图）\n2. 确保表格权限已设置为“知道链接的任何人”可查看\n3. 尝试刷新页面后重试");
        }
    }
};

/**
 * Fetch data from Google Sheets using authenticated API (for large datasets 10万+ rows)
 * This uses the Google Sheets API with OAuth token for better performance and reliability
 */
export interface SheetMetadata {
    title: string;
    sheetId: number;
    rowCount?: number;
    columnCount?: number;
}

export interface SpreadsheetInfo {
    title: string; // The spreadsheet title (document name)
    sheets: SheetMetadata[];
}

const MAX_EXPORT_COLUMNS = 702; // ZZ - keep parity with existing export limit

const columnIndexToLetter = (index: number): string => {
    let col = Math.max(1, index);
    let letters = '';
    while (col > 0) {
        const remainder = (col - 1) % 26;
        letters = String.fromCharCode(65 + remainder) + letters;
        col = Math.floor((col - 1) / 26);
    }
    return letters;
};

const getFetchEndColumn = (columnCount?: number): string => {
    const safeCount = columnCount && columnCount > 0
        ? Math.min(columnCount, MAX_EXPORT_COLUMNS)
        : MAX_EXPORT_COLUMNS;
    return columnIndexToLetter(safeCount);
};

export const fetchGoogleSpreadsheetMetadata = async (
    spreadsheetId: string,
    accessToken: string
): Promise<SheetMetadata[]> => {
    const info = await fetchGoogleSpreadsheetInfo(spreadsheetId, accessToken);
    return info.sheets;
};

export const fetchGoogleSpreadsheetInfo = async (
    spreadsheetId: string,
    accessToken: string
): Promise<SpreadsheetInfo> => {
    const metaResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`,
        {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );

    if (!metaResponse.ok) {
        if (metaResponse.status === 401) {
            throw new Error("Google 认证已过期，请重新登录。");
        }
        if (metaResponse.status === 403) {
            throw new Error("没有权限访问此表格。请确保：\n1. 表格已与您的账号共享\n2. 或将表格设置为「知道链接的任何人可查看」");
        }
        throw new Error(`获取表格信息失败: ${metaResponse.status}`);
    }

    const meta = await metaResponse.json();
    const spreadsheetTitle = meta.properties?.title || 'Google Sheet';
    const sheets = meta.sheets || [];

    if (sheets.length === 0) {
        throw new Error("表格中没有工作表");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
        title: spreadsheetTitle,
        sheets: sheets.map((s: any) => ({
            title: s.properties.title,
            sheetId: s.properties.sheetId,
            rowCount: s.properties.gridProperties?.rowCount,
            columnCount: s.properties.gridProperties?.columnCount
        }))
    };
};

export const fetchGoogleSpreadsheetInfoWithApiKey = async (
    spreadsheetId: string
): Promise<SpreadsheetInfo> => {
    const metaResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties&key=${GOOGLE_API_KEY}`
    );

    if (!metaResponse.ok) {
        if (metaResponse.status === 403 || metaResponse.status === 404) {
            throw new Error('PRIVATE_SPREADSHEET');
        }
        throw new Error(`获取表格信息失败: ${metaResponse.status}`);
    }

    const meta = await metaResponse.json();
    const spreadsheetTitle = meta.properties?.title || 'Google Sheet';
    const sheets = meta.sheets || [];

    if (sheets.length === 0) {
        throw new Error("表格中没有工作表");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
        title: spreadsheetTitle,
        sheets: sheets.map((s: any) => ({
            title: s.properties.title,
            sheetId: s.properties.sheetId,
            rowCount: s.properties.gridProperties?.rowCount,
            columnCount: s.properties.gridProperties?.columnCount
        }))
    };
};

/**
 * Filter a workbook to only include specified sheet names
 */
export const filterWorkbook = (workbook: XLSX.WorkBook, allowedSheetNames: string[]): XLSX.WorkBook => {
    // If no filter specified or empty filter, return original (or should we return empty? usually means all if undefined, but strict if array provided)
    // Here we assume if allowedSheetNames is provided, we strictly filter.

    const newWb = XLSX.utils.book_new();
    const allowedSet = new Set(allowedSheetNames);

    workbook.SheetNames.forEach(name => {
        if (allowedSet.has(name)) {
            const sheet = workbook.Sheets[name];
            XLSX.utils.book_append_sheet(newWb, sheet, sanitizeSheetName(name));
        }
    });

    return newWb;
};

// ==================== IMPORTRANGE Detection ====================

export interface ImportRangeReference {
    spreadsheetUrl: string;
    spreadsheetId: string;
    range: string;
    sheetName?: string; // Extracted from range if available
    foundInSheet: string;
    foundInCell: string;
}

/**
 * Parse IMPORTRANGE formula to extract spreadsheet URL and range
 * Formats:
 * =IMPORTRANGE("url", "range")
 * =IMPORTRANGE("url", "Sheet!A:Z")
 */
const parseImportRangeFormula = (formula: string): { url: string; range: string } | null => {
    // Match IMPORTRANGE pattern (case insensitive)
    const match = formula.match(/IMPORTRANGE\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/i);
    if (!match) return null;
    return { url: match[1], range: match[2] };
};

/**
 * Extract spreadsheet ID from Google Sheets URL
 */
const extractSpreadsheetId = (url: string): string | null => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
};

/**
 * Extract sheet name from range string (e.g., "Sheet1!A:Z" -> "Sheet1")
 */
const extractSheetNameFromRange = (range: string): string | undefined => {
    const match = range.match(/^([^!]+)!/);
    return match ? match[1] : undefined;
};

/**
 * Detect IMPORTRANGE formulas in a workbook and return all referenced spreadsheets
 */
export const detectImportRangeReferences = (workbook: XLSX.WorkBook): ImportRangeReference[] => {
    const references: ImportRangeReference[] = [];
    const seenUrls = new Set<string>(); // Deduplicate by URL

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        // Iterate through all cells
        for (const cellAddress of Object.keys(sheet)) {
            if (cellAddress.startsWith('!')) continue; // Skip metadata keys

            const cell = sheet[cellAddress];
            if (!cell) continue;

            // Check if cell contains a formula
            const cellValue = cell.f || cell.v || '';
            const cellStr = String(cellValue);

            if (cellStr.toUpperCase().includes('IMPORTRANGE')) {
                const parsed = parseImportRangeFormula(cellStr);
                if (parsed) {
                    const spreadsheetId = extractSpreadsheetId(parsed.url);
                    if (spreadsheetId && !seenUrls.has(parsed.url)) {
                        seenUrls.add(parsed.url);
                        references.push({
                            spreadsheetUrl: parsed.url,
                            spreadsheetId,
                            range: parsed.range,
                            sheetName: extractSheetNameFromRange(parsed.range),
                            foundInSheet: sheetName,
                            foundInCell: cellAddress
                        });
                    }
                }
            }
        }
    }

    return references;
};

/**
 * Detect IMPORTRANGE formulas from Google Sheets API (using FORMULA render option)
 * This scans the raw data array for IMPORTRANGE patterns
 */
export const detectImportRangeFromData = (
    data: string[][],
    sheetName: string
): ImportRangeReference[] => {
    const references: ImportRangeReference[] = [];
    const seenUrls = new Set<string>();

    for (let row = 0; row < data.length; row++) {
        for (let col = 0; col < (data[row]?.length || 0); col++) {
            const cellValue = data[row][col];
            if (!cellValue) continue;

            const cellStr = String(cellValue);
            if (cellStr.toUpperCase().includes('IMPORTRANGE')) {
                const parsed = parseImportRangeFormula(cellStr);
                if (parsed) {
                    const spreadsheetId = extractSpreadsheetId(parsed.url);
                    if (spreadsheetId && !seenUrls.has(parsed.url)) {
                        seenUrls.add(parsed.url);
                        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                        references.push({
                            spreadsheetUrl: parsed.url,
                            spreadsheetId,
                            range: parsed.range,
                            sheetName: extractSheetNameFromRange(parsed.range),
                            foundInSheet: sheetName,
                            foundInCell: cellAddress
                        });
                    }
                }
            }
        }
    }

    return references;
};

// Extended workbook type with IMPORTRANGE references
export interface WorkBookWithRefs extends XLSX.WorkBook {
    _importRangeRefs?: ImportRangeReference[];
}

/**
 * Fetch data from Google Sheets using authenticated API (for large datasets 10万+ rows)
 * This uses the Google Sheets API with OAuth token for better performance and reliability
 */
export const fetchWorkbookWithAuth = async (
    url: string,
    accessToken: string,
    onProgress?: (msg: string, percent?: number) => void,
    allowedSheetNames?: string[] // Optional filter
): Promise<XLSX.WorkBook> => {
    // 1. Extract Sheet ID
    const matches = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!matches || !matches[1]) {
        throw new Error("无效的 Google 表格链接。请确保链接包含 '/d/SheetID'。");
    }
    const spreadsheetId = matches[1];

    onProgress?.('正在通过 API 获取表格信息...', 5);

    // 2. Get spreadsheet metadata to find sheet names
    const sheets = await fetchGoogleSpreadsheetMetadata(spreadsheetId, accessToken);

    // Filter sheets if allowedSheetNames is provided
    let sheetsToLoad = allowedSheetNames
        ? sheets.filter(s => allowedSheetNames.includes(s.title))
        : sheets;

    // 如果指定的分页名全部失效（可能被重命名或删除），回退到加载所有分页
    if (sheetsToLoad.length === 0 && allowedSheetNames && allowedSheetNames.length > 0) {
        console.warn('[fetchWorkbookWithAuth] All allowed sheets are gone, falling back to all sheets:', allowedSheetNames);
        sheetsToLoad = sheets;
    }

    if (sheetsToLoad.length === 0) {
        // No sheets available at all
        return XLSX.utils.book_new();
    }

    // 3. Create workbook and load ALL (filtered) sheets
    const wb = XLSX.utils.book_new();
    const totalSheets = sheetsToLoad.length; // Use filtered length
    const allImportRangeRefs: ImportRangeReference[] = []; // Collect IMPORTRANGE refs

    for (let sheetIdx = 0; sheetIdx < totalSheets; sheetIdx++) {
        const sheetProps = sheetsToLoad[sheetIdx];
        const sheetName = sheetProps.title;
        const totalRows = sheetProps.rowCount || 1000;
        const endColumn = getFetchEndColumn(sheetProps.columnCount);

        const sheetProgress = Math.floor((sheetIdx / totalSheets) * 80) + 10;
        onProgress?.(`正在加载工作表 "${sheetName}" (${sheetIdx + 1}/${totalSheets})...`, sheetProgress);

        // Fetch data in batches for very large sheets
        // Strategy: Fetch FORMATTED_VALUE (computed values) as primary data
        // Then fetch FORMULA separately to detect IMAGE formulas and preserve them
        const BATCH_SIZE = 10000; // 10K rows per batch
        const allData: string[][] = [];
        const allFormulas: string[][] = []; // For detecting IMAGE formulas
        let currentRow = 1;

        while (currentRow <= totalRows) {
            const endRow = Math.min(currentRow + BATCH_SIZE - 1, totalRows);
            const range = `${sheetName}!A${currentRow}:${endColumn}${endRow}`;

            // Fetch computed values (this will resolve IMPORTRANGE!)
            const valueResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
                {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                }
            );

            if (!valueResponse.ok) {
                if (valueResponse.status === 429) {
                    // Rate limited, wait and retry
                    onProgress?.('API 限制中，等待重试...', sheetProgress);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                // Skip this sheet on error, continue with others
                console.warn(`Failed to load sheet ${sheetName}: ${valueResponse.status}`);
                break;
            }

            const valueData = await valueResponse.json();
            const values = valueData.values || [];

            if (values.length === 0) {
                break;
            }

            // Also fetch formulas to detect IMAGE and IMPORTRANGE patterns
            const formulaResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`,
                {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                }
            );

            let formulas: string[][] = [];
            if (formulaResponse.ok) {
                const formulaData = await formulaResponse.json();
                formulas = formulaData.values || [];
            }

            // Merge: use computed values, but preserve IMAGE formulas
            const mergedData: string[][] = [];
            for (let r = 0; r < values.length; r++) {
                const row: string[] = [];
                const maxCols = Math.max(values[r]?.length || 0, formulas[r]?.length || 0);

                for (let c = 0; c < maxCols; c++) {
                    const formulaVal = formulas[r]?.[c] || '';
                    const computedVal = values[r]?.[c] || '';

                    const imageFormulaUrl = extractImageFromFormula(formulaVal);
                    const isImageFormula = typeof formulaVal === 'string' && /^=IMAGE\s*\(/i.test(formulaVal);
                    const isImageHyperlink = typeof formulaVal === 'string' && /^=HYPERLINK\s*\(/i.test(formulaVal);

                    // Preserve image-related formulas so thumbnails can render
                    if (imageFormulaUrl && (isImageFormula || isImageHyperlink)) {
                        row.push(formulaVal);
                    } else {
                        // Use computed value (this resolves IMPORTRANGE, etc.)
                        row.push(computedVal);
                    }
                }
                mergedData.push(row);
            }

            allData.push(...mergedData);
            allFormulas.push(...formulas);
            currentRow = endRow + 1;

            if (values.length < BATCH_SIZE) {
                break;
            }
        }

        // Detect IMPORTRANGE references from formulas (for logging/reference)
        const sheetRefs = detectImportRangeFromData(allFormulas, sheetName);
        allImportRangeRefs.push(...sheetRefs);

        // Add sheet to workbook (sanitize name to remove illegal characters)
        const safeSheetName = sanitizeSheetName(sheetName);
        if (allData.length > 0) {
            const ws = XLSX.utils.aoa_to_sheet(allData);
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
        } else {
            // Add empty sheet placeholder
            const ws = XLSX.utils.aoa_to_sheet([[]]);
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
        }
    }

    // Log detected IMPORTRANGE references
    if (allImportRangeRefs.length > 0) {
    }

    onProgress?.(`完成！共加载 ${totalSheets} 个工作表`, 100);

    // Store references on workbook for later access
    (wb as WorkBookWithRefs)._importRangeRefs = allImportRangeRefs;

    return wb;
};

/**
 * Get IMPORTRANGE references from a workbook (if detected during loading)
 */
export const getImportRangeReferences = (workbook: XLSX.WorkBook): ImportRangeReference[] => {
    return (workbook as WorkBookWithRefs)._importRangeRefs || [];
};

/**
 * Get the Service Account email for sharing private spreadsheets
 */
export const getServiceAccountEmail = (): string => {
    return SERVICE_ACCOUNT_EMAIL;
};

/**
 * Fetch workbook using API Key (for public spreadsheets - never expires!)
 * This is the preferred method for public spreadsheets as it doesn't require user login
 */
export const fetchWorkbookWithApiKey = async (
    url: string,
    onProgress?: (msg: string, percent?: number) => void,
    allowedSheetNames?: string[]
): Promise<XLSX.WorkBook> => {
    // 1. Extract Sheet ID
    const matches = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!matches || !matches[1]) {
        throw new Error("无效的 Google 表格链接。请确保链接包含 '/d/SheetID'。");
    }
    const spreadsheetId = matches[1];

    onProgress?.('正在使用 API Key 加载...', 5);

    // 2. Get spreadsheet metadata
    let allSheets: SheetMetadata[];
    try {
        const spreadsheetInfo = await fetchGoogleSpreadsheetInfoWithApiKey(spreadsheetId);
        allSheets = spreadsheetInfo.sheets;
    } catch (error) {
        if (error instanceof Error && error.message.includes('PRIVATE_SPREADSHEET')) {
            throw new Error(`PRIVATE_SPREADSHEET:此表格为私有，需要授权访问。\n\n请选择以下方式之一：\n1. 重新登录 Google 账号\n2. 将表格设为公开（知道链接的任何人可查看）\n3. 将表格共享给服务账号：\n   ${SERVICE_ACCOUNT_EMAIL}`);
        }
        throw error;
    }

    let sheetsToLoad = allowedSheetNames
        ? allSheets.filter((s: SheetMetadata) => allowedSheetNames.includes(s.title))
        : allSheets;

    // 如果指定的分页名全部失效（可能被重命名或删除），回退到加载所有分页
    if (sheetsToLoad.length === 0 && allowedSheetNames && allowedSheetNames.length > 0) {
        console.warn('[fetchWorkbookWithApiKey] All allowed sheets are gone, falling back to all sheets:', allowedSheetNames);
        sheetsToLoad.push(...allSheets);
    }

    if (sheetsToLoad.length === 0) {
        return XLSX.utils.book_new();
    }

    // 3. Create workbook and load all sheets
    const wb = XLSX.utils.book_new();
    const totalSheets = sheetsToLoad.length;

    for (let sheetIdx = 0; sheetIdx < totalSheets; sheetIdx++) {
        const sheetProps = sheetsToLoad[sheetIdx];
        const sheetName = sheetProps.title;
        const totalRows = sheetProps.rowCount || 1000;
        const endColumn = getFetchEndColumn(sheetProps.columnCount);

        const sheetProgress = Math.floor((sheetIdx / totalSheets) * 80) + 10;
        onProgress?.(`正在加载 "${sheetName}" (${sheetIdx + 1}/${totalSheets})...`, sheetProgress);

        // Fetch data in batches
        const BATCH_SIZE = 10000;
        const allData: string[][] = [];
        let currentRow = 1;

        while (currentRow <= totalRows) {
            const endRow = Math.min(currentRow + BATCH_SIZE - 1, totalRows);
            const range = `${sheetName}!A${currentRow}:${endColumn}${endRow}`;

            // Fetch computed values with API key
            const valueResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE&key=${GOOGLE_API_KEY}`
            );

            if (!valueResponse.ok) {
                if (valueResponse.status === 429) {
                    onProgress?.('API 限制中，等待重试...', sheetProgress);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                console.warn(`Failed to load sheet ${sheetName}: ${valueResponse.status}`);
                break;
            }

            const valueData = await valueResponse.json();
            const values = valueData.values || [];

            if (values.length === 0) {
                break;
            }

            // Also fetch formulas to preserve IMAGE formulas
            const formulaResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA&key=${GOOGLE_API_KEY}`
            );

            let formulas: string[][] = [];
            if (formulaResponse.ok) {
                const formulaData = await formulaResponse.json();
                formulas = formulaData.values || [];
            }

            // Merge: use computed values, but preserve IMAGE formulas
            const mergedData: string[][] = [];
            for (let r = 0; r < values.length; r++) {
                const row: string[] = [];
                const maxCols = Math.max(values[r]?.length || 0, formulas[r]?.length || 0);

                for (let c = 0; c < maxCols; c++) {
                    const formulaVal = formulas[r]?.[c] || '';
                    const computedVal = values[r]?.[c] || '';

                    const imageFormulaUrl = extractImageFromFormula(formulaVal);
                    const isImageFormula = typeof formulaVal === 'string' && /^=IMAGE\s*\(/i.test(formulaVal);
                    const isImageHyperlink = typeof formulaVal === 'string' && /^=HYPERLINK\s*\(/i.test(formulaVal);

                    // Preserve image-related formulas so thumbnails can render
                    if (imageFormulaUrl && (isImageFormula || isImageHyperlink)) {
                        row.push(formulaVal);
                    } else {
                        // Use computed value
                        row.push(computedVal);
                    }
                }
                mergedData.push(row);
            }

            allData.push(...mergedData);
            currentRow = endRow + 1;

            if (values.length < BATCH_SIZE) {
                break;
            }
        }

        // Add sheet to workbook (sanitize name to remove illegal characters)
        const safeSheetName = sanitizeSheetName(sheetName);
        if (allData.length > 0) {
            const ws = XLSX.utils.aoa_to_sheet(allData);
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
        } else {
            const ws = XLSX.utils.aoa_to_sheet([[]]);
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
        }
    }

    onProgress?.(`完成！共加载 ${totalSheets} 个工作表`, 100);
    return wb;
};

/**
 * Smart loader: Try API Key first (for public), fallback to OAuth if private
 * This provides the best UX - no login needed for public spreadsheets
 */
export const fetchWorkbookSmart = async (
    url: string,
    accessToken: string | null,
    onProgress?: (msg: string, percent?: number) => void,
    allowedSheetNames?: string[]
): Promise<XLSX.WorkBook> => {

    // Try API Key first (works for public spreadsheets, never expires)
    try {
        onProgress?.('尝试使用 API Key 加载...', 0);
        const wb = await fetchWorkbookWithApiKey(url, onProgress, allowedSheetNames);
        return wb;
    } catch (apiKeyError) {
        const errorMsg = apiKeyError instanceof Error ? apiKeyError.message : '';

        // If it's a private spreadsheet error
        if (errorMsg.includes('PRIVATE_SPREADSHEET')) {
            // Try OAuth token if available
            if (accessToken) {
                onProgress?.('表格为私有，使用登录凭证加载...', 0);
                try {
                    const wb = await fetchWorkbookWithAuth(url, accessToken, onProgress, allowedSheetNames);
                    return wb;
                } catch (authError) {
                    console.error('[SmartLoader] OAuth 加载失败:', authError);
                    // OAuth also failed
                    throw new Error(`无法访问此表格。\n\n请选择以下方式之一：\n\n1. 🔄 重新登录 Google 账号\n\n2. 🌐 将表格设为公开\n   在表格设置中选择"知道链接的任何人可查看"\n\n3. 📧 共享给服务账号\n   将此邮箱添加为表格的查看者：\n   ${SERVICE_ACCOUNT_EMAIL}`);
                }
            } else {
                // No OAuth token, show all options
                throw new Error(`无法访问此表格（表格为私有）。\n\n请选择以下方式之一：\n\n1. 🔄 登录 Google 账号\n\n2. 🌐 将表格设为公开\n   在表格设置中选择"知道链接的任何人可查看"\n\n3. 📧 共享给服务账号\n   将此邮箱添加为表格的查看者：\n   ${SERVICE_ACCOUNT_EMAIL}`);
            }
        }

        // Other errors, rethrow
        console.error('[SmartLoader] 其他错误:', apiKeyError);
        throw apiKeyError;
    }
};

// Helper to convert Excel serial date to readable format
const excelSerialToDate = (serial: number): string => {
    // Excel epoch is January 1, 1900 (but with a leap year bug for 1900)
    // JavaScript Date epoch is January 1, 1970
    const excelEpoch = new Date(1899, 11, 30); // December 30, 1899
    const millisecondsPerDay = 24 * 60 * 60 * 1000;

    const date = new Date(excelEpoch.getTime() + serial * millisecondsPerDay);

    // Format as YYYY-MM-DD HH:mm if there's a time component
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

// Check if a number looks like an Excel date serial
const looksLikeExcelDate = (value: number): boolean => {
    // Excel dates typically range from ~1 (Jan 1, 1900) to ~50000 (year 2037)
    // Avoid converting regular numbers like prices, quantities, etc.
    return value >= 1 && value <= 60000 && !Number.isInteger(value * 10000);
};

// --- Level 2: Parse Specific Sheet ---

export const parseSheet = (workbook: XLSX.WorkBook, sheetName: string, fileName: string): SheetData => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`找不到工作表: ${sheetName}`);

    // PRE-PROCESSING:
    // Extract Image Formulas and convert date serial numbers
    // Optimization: Limit processing for very large sheets
    if (sheet['!ref']) {
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const totalRows = range.e.r - range.s.r + 1;
        const totalCols = range.e.c - range.s.c + 1;

        // Performance optimization: For very large datasets (>100k rows),
        // skip intensive cell-by-cell preprocessing - let DataGrid handle display
        const isLargeDataset = totalRows > 100000;

        // Cache date column indices to avoid repeated header lookups
        const dateColumnIndices = new Set<number>();

        // Only check headers once for date columns (first row only)
        if (!isLargeDataset) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const headerCell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
                const headerValue = headerCell?.v?.toString().toLowerCase() || '';
                if (/日期|date|time|时间|创建|更新|发布/.test(headerValue)) {
                    dateColumnIndices.add(C);
                }
            }
        }

        // Process cells - limit to first 50k rows for performance
        const maxRowsToProcess = Math.min(range.e.r, range.s.r + 50000);

        for (let R = range.s.r; R <= maxRowsToProcess; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = sheet[cellAddress];

                if (cell) {
                    // Preserve image-related formulas for rendering thumbnails
                    if (cell.f) {
                        const formulaText = '=' + cell.f;
                        // Quick check before expensive regex
                        const upperFormula = formulaText.toUpperCase();
                        if (upperFormula.includes('IMAGE') || upperFormula.includes('HYPERLINK')) {
                            const imageUrl = extractImageFromFormula(formulaText);
                            const isImageFormula = /^=IMAGE\s*\(/i.test(formulaText);
                            const isImageHyperlink = /^=HYPERLINK\s*\(/i.test(formulaText);

                            if (imageUrl && (isImageFormula || isImageHyperlink)) {
                                cell.v = formulaText;
                                cell.t = 's';
                                if (cell.w) delete cell.w;
                            }
                        }
                    }

                    // Convert Excel date serial numbers to readable dates
                    // Use cached date column check and cell format check
                    if (cell.t === 'n' && typeof cell.v === 'number' && looksLikeExcelDate(cell.v)) {
                        const isDateColumn = dateColumnIndices.has(C);
                        const hasDateFormat = cell.z && (cell.z.includes('yy') || cell.z.includes('mm') || cell.z.includes('dd'));

                        if (isDateColumn || hasDateFormat) {
                            cell.w = excelSerialToDate(cell.v);
                            cell.v = cell.w;
                            cell.t = 's';
                        }
                    }
                }
            }
        }
    }

    // Convert to JSON
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as (DataRow & { __rowNum__?: number })[];

    const rowsWithIndex = rawData.map((row, idx) => ({
        ...row,
        _originalRowIndex: typeof row.__rowNum__ === 'number' ? row.__rowNum__ + 1 : idx + 2
    }));

    if (rowsWithIndex.length === 0) {
        // Return empty structure instead of throwing, so UI can show "Empty Sheet"
        return {
            fileName,
            sheetName,
            sheetNames: workbook.SheetNames,
            columns: [],
            rows: []
        };
    }

    // Extract columns from the first row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstRow = rawData[0] as any;
    const columns = Object.keys(firstRow).filter(k => k !== '__rowNum__');
    const rows = rowsWithIndex;

    return {
        fileName,
        sheetName,
        sheetNames: workbook.SheetNames,
        columns,
        rows
    };
};

const normalizeHeaders = (rawHeaders: unknown[]): string[] => {
    const headers: string[] = [];
    const used = new Map<string, number>();
    let emptyCount = 0;

    rawHeaders.forEach((val) => {
        let name = String(val ?? '').trim();
        if (!name) {
            name = emptyCount === 0 ? '__EMPTY' : `__EMPTY_${emptyCount}`;
            emptyCount += 1;
        }

        const seen = used.get(name) || 0;
        if (seen > 0) {
            const nextName = `${name}_${seen}`;
            used.set(name, seen + 1);
            name = nextName;
        } else {
            used.set(name, 1);
        }

        headers.push(name);
    });

    return headers;
};

export const parseSheetAsync = async (
    workbook: XLSX.WorkBook,
    sheetName: string,
    fileName: string,
    options?: { chunkSize?: number; onProgress?: (percent: number) => void }
): Promise<SheetData> => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`找不到工作表: ${sheetName}`);

    if (!sheet['!ref']) {
        return {
            fileName,
            sheetName,
            sheetNames: workbook.SheetNames,
            columns: [],
            rows: []
        };
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const chunkSize = options?.chunkSize ?? 1000;
    const headerRowIndex = range.s.r;

    const headerValues: string[] = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const headerCell = sheet[XLSX.utils.encode_cell({ r: headerRowIndex, c: C })];
        headerValues.push(headerCell?.v?.toString().toLowerCase() || '');
    }

    const preprocessChunk = async (startRow: number, endRow: number) => {
        for (let R = startRow; R <= endRow; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = sheet[cellAddress];
                if (!cell) continue;

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
                    const headerValue = headerValues[C - range.s.c] || '';
                    const isDateColumn = /日期|date|time|时间|创建|更新|发布/.test(headerValue);
                    if (isDateColumn || cell.z?.includes('yy') || cell.z?.includes('mm') || cell.z?.includes('dd')) {
                        cell.w = excelSerialToDate(cell.v);
                        cell.v = cell.w;
                        cell.t = 's';
                    }
                }
            }
        }

        await new Promise(resolve => setTimeout(resolve, 0));
    };

    await preprocessChunk(headerRowIndex, headerRowIndex);

    const headerRow = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range: { s: { r: headerRowIndex, c: range.s.c }, e: { r: headerRowIndex, c: range.e.c } },
        defval: ""
    })[0] as unknown[] | undefined;
    const columns = normalizeHeaders(headerRow || []);

    const rows: DataRow[] = [];
    const totalRows = range.e.r;
    let currentRow = headerRowIndex + 1;

    while (currentRow <= totalRows) {
        const endRow = Math.min(currentRow + chunkSize - 1, totalRows);
        await preprocessChunk(currentRow, endRow);

        const chunk = XLSX.utils.sheet_to_json(sheet, {
            defval: "",
            header: columns,
            range: { s: { r: currentRow, c: range.s.c }, e: { r: endRow, c: range.e.c } }
        }) as (DataRow & { __rowNum__?: number })[];

        const rowsWithIndex = chunk.map(row => ({
            ...row,
            _originalRowIndex: typeof row.__rowNum__ === 'number' ? row.__rowNum__ + 1 : currentRow + 1
        }));

        rows.push(...rowsWithIndex);
        currentRow = endRow + 1;

        if (options?.onProgress && totalRows > headerRowIndex + 1) {
            const processed = Math.min(totalRows, currentRow);
            const percent = Math.floor(((processed - (headerRowIndex + 1)) / (totalRows - headerRowIndex)) * 100);
            options.onProgress(Math.max(0, Math.min(100, percent)));
        }
    }

    return {
        fileName,
        sheetName,
        sheetNames: workbook.SheetNames,
        columns,
        rows
    };
};

/**
 * Parse and merge multiple sheets into a single SheetData
 * Adds _sourceSheet column to track origin of each row
 */
export const parseMultipleSheets = (
    workbook: XLSX.WorkBook,
    sheetNames: string[],
    fileName: string
): SheetData => {
    const allRows: DataRow[] = [];
    const columnSet = new Set<string>();

    // First pass: collect all columns from all sheets
    for (const sheetName of sheetNames) {
        try {
            const sheetData = parseSheet(workbook, sheetName, fileName);
            sheetData.columns.forEach(col => columnSet.add(col));
        } catch (e) {
            console.warn(`Skipping sheet "${sheetName}":`, e);
        }
    }

    // Second pass: collect all rows with source sheet marker
    for (const sheetName of sheetNames) {
        try {
            const sheetData = parseSheet(workbook, sheetName, fileName);
            sheetData.rows.forEach((row, idx) => {
                allRows.push({
                    _sourceSheet: sheetName,
                    ...row
                });
            });
        } catch (e) {
            // Already warned above
        }
    }

    // Build merged column list (add _sourceSheet at front)
    const columns = ['_sourceSheet', ...Array.from(columnSet)];

    return {
        fileName,
        sheetName: `合并 (${sheetNames.length}个分页)`,
        sheetNames: workbook.SheetNames,
        columns,
        rows: allRows
    };
};

export const parseMultipleSheetsAsync = async (
    workbook: XLSX.WorkBook,
    sheetNames: string[],
    fileName: string,
    options?: { chunkSize?: number; onProgress?: (percent: number) => void }
): Promise<SheetData> => {
    const allRows: DataRow[] = [];
    const columnSet = new Set<string>();

    for (let i = 0; i < sheetNames.length; i++) {
        const sheetName = sheetNames[i];
        try {
            const sheetData = await parseSheetAsync(workbook, sheetName, fileName, { chunkSize: options?.chunkSize });
            sheetData.rows.forEach((row, idx) => {
                allRows.push({
                    _sourceSheet: sheetName,
                    ...row
                });
            });
            sheetData.columns.forEach(col => columnSet.add(col));

            if (options?.onProgress) {
                const percent = Math.floor(((i + 1) / sheetNames.length) * 100);
                options.onProgress(percent);
            }
        } catch (e) {
            // Already warned above
        }
    }

    const columns = ['_sourceSheet', ...Array.from(columnSet)];

    return {
        fileName,
        sheetName: `合并 (${sheetNames.length}个分页)`,
        sheetNames: workbook.SheetNames,
        columns,
        rows: allRows
    };
};


// Helper to extract image URL from Google Sheet formula like =IMAGE("url")
const isLikelyImageUrl = (url: string): boolean => {
    if (!/^https?:\/\//i.test(url)) return false;

    const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i;
    if (imageExtensions.test(url)) return true;

    if (/googleusercontent\.com|drive\.google\.com/i.test(url)) return true;
    if (/gyazo\.com|imgur\.com|imgbb\.com|cloudinary\.com|unsplash\.com|pexels\.com|flickr\.com|pinterest\.com|instagram\.com/i.test(url)) return true;

    return false;
};

export const extractImageFromFormula = (cellValue: string | number | boolean | null): string | null => {
    if (typeof cellValue !== 'string') return null;

    const strVal = cellValue.trim();

    // Pattern 1: =IMAGE("https://...") - Handles double quotes
    const imageFormulaRegex = /^=IMAGE\s*\(\s*"([^"]+)"/i;
    const match = strVal.match(imageFormulaRegex);
    if (match) return match[1];

    // Pattern 2: =IMAGE('https://...') - Handles single quotes (sometimes used)
    const imageFormulaSingleQuoteRegex = /^=IMAGE\s*\(\s*'([^']+)'/i;
    const matchSingle = strVal.match(imageFormulaSingleQuoteRegex);
    if (matchSingle) return matchSingle[1];

    // Pattern 3: =IMAGE(https://...) - Unquoted URL
    const imageFormulaUnquotedRegex = /^=IMAGE\s*\(\s*(https?:\/\/[^,\s)]+)/i;
    const matchUnquoted = strVal.match(imageFormulaUnquotedRegex);
    if (matchUnquoted) return matchUnquoted[1];

    // Pattern 4: =IMAGE(HYPERLINK("url", ...))
    const imageHyperlinkRegex = /^=IMAGE\s*\(\s*HYPERLINK\s*\(\s*"([^"]+)"/i;
    const matchImageHyperlink = strVal.match(imageHyperlinkRegex);
    if (matchImageHyperlink) return matchImageHyperlink[1];
    const imageHyperlinkSingleRegex = /^=IMAGE\s*\(\s*HYPERLINK\s*\(\s*'([^']+)'/i;
    const matchImageHyperlinkSingle = strVal.match(imageHyperlinkSingleRegex);
    if (matchImageHyperlinkSingle) return matchImageHyperlinkSingle[1];

    // Pattern 5: =HYPERLINK("url", ...) - treat as image only if URL looks like an image
    const hyperlinkRegex = /^=HYPERLINK\s*\(\s*"([^"]+)"/i;
    const hyperlinkMatch = strVal.match(hyperlinkRegex);
    if (hyperlinkMatch && isLikelyImageUrl(hyperlinkMatch[1])) return hyperlinkMatch[1];
    const hyperlinkSingleRegex = /^=HYPERLINK\s*\(\s*'([^']+)'/i;
    const hyperlinkMatchSingle = strVal.match(hyperlinkSingleRegex);
    if (hyperlinkMatchSingle && isLikelyImageUrl(hyperlinkMatchSingle[1])) return hyperlinkMatchSingle[1];

    // Pattern 6: Direct HTTP link ending in image extension
    const urlRegex = /^https?:\/\/.*\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i;
    if (urlRegex.test(strVal)) return strVal;

    return null;
};

// Helper to fetch image and convert to Base64 for Gemini
export const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
    try {
        // Attempt 1: Direct Fetch (works if CORS is allowed)
        try {
            const response = await fetch(url);
            if (response.ok) {
                const blob = await response.blob();
                if (blob.type.startsWith('image/')) {
                    return await blobToBase64(blob);
                }
            }
        } catch (e) {
            // Ignore direct fetch error, try proxy
        }

        // Attempt 2: Robust Proxy Fetch
        // We use images.weserv.nl for images as it handles headers/resizing/types well for images specifically
        const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(url)}&output=jpg&w=512`;
        const response = await fetch(proxyUrl);
        const blob = await response.blob();

        // We accept standard image types
        if (!blob.type.startsWith('image/')) return null;

        return await blobToBase64(blob);

    } catch (err) {
        console.warn("Failed to fetch image for analysis:", url);
        return null;
    }
};

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result as string;
            // Remove data:image/xxx;base64, prefix for API
            const base64Data = base64String.split(',')[1];
            resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};
