/**
 * SheetMind Firebase Service
 * Handles cloud sync for TransposePanel configurations and presets
 */

import { db, auth } from '@/firebase/index';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';

// Types
export interface CloudPreset {
    id: string;
    name: string;
    config: Record<string, unknown>;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    userId: string;
}

export interface CloudSheetData {
    id: string;
    name: string;
    columns: string[];
    rows: Record<string, unknown>[];
    source?: 'paste' | 'sheets' | 'csv';
    sheetsUrl?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    userId: string;
}

// Collection names
const PRESETS_COLLECTION = 'sheetmind_presets';
const DATA_COLLECTION = 'sheetmind_data';

/**
 * Get current user ID
 */
const getUserId = (): string | null => {
    return auth.currentUser?.uid || null;
};

// ==================== Presets ====================

/**
 * Save a preset to Firebase
 */
export const savePresetToCloud = async (preset: {
    id: string;
    name: string;
    config: Record<string, unknown>;
}): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, PRESETS_COLLECTION, `${userId}_${preset.id}`);
    await setDoc(docRef, {
        ...preset,
        userId,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
    }, { merge: true });
};

/**
 * Load all presets for current user
 */
export const loadPresetsFromCloud = async (): Promise<CloudPreset[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const q = query(
        collection(db, PRESETS_COLLECTION),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.data().id,
        ...doc.data()
    } as CloudPreset));
};

/**
 * Delete a preset from Firebase
 */
export const deletePresetFromCloud = async (presetId: string): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, PRESETS_COLLECTION, `${userId}_${presetId}`);
    await deleteDoc(docRef);
};

// ==================== Data Sources (Cross-device sync) ====================
const DATA_SOURCES_COLLECTION = 'sheetmind_data_sources';

export interface CloudDataSource {
    id: string;
    name: string;
    url: string;
    type: 'google-sheets' | 'local-file' | 'manual';
    addedAt: number;
    lastUsedAt?: number;
    rowCount?: number;
    isActive?: boolean;
    selectedSheets?: string[];
}

/**
 * Save all data sources to Firebase (replaces existing)
 */
export const saveDataSourcesToCloud = async (sources: CloudDataSource[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, DATA_SOURCES_COLLECTION, userId);
    await setDoc(docRef, {
        sources,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load data sources from Firebase
 */
export const loadDataSourcesFromCloud = async (): Promise<CloudDataSource[]> => {
    const userId = getUserId();
    if (!userId) {
        return [];
    }

    try {
        const startTime = Date.now();

        const docRef = doc(db, DATA_SOURCES_COLLECTION, userId);
        const docSnap = await getDoc(docRef);

        const elapsed = Date.now() - startTime;

        if (docSnap.exists()) {
            const rawData = docSnap.data();
            const data = rawData.sources || [];
            return data;
        }
        return [];
    } catch (error) {
        console.error('[CloudSync] ❌ Error loading from cloud:', error);
        // 返回空数组而不是抛出错误，允许继续使用本地数据
        return [];
    }
};

/**
 * Merge cloud and local data sources (cloud takes priority for same URL)
 */
export const mergeDataSources = (
    localSources: CloudDataSource[],
    cloudSources: CloudDataSource[]
): CloudDataSource[] => {
    const urlMap = new Map<string, CloudDataSource>();

    // Add local sources first
    for (const source of localSources) {
        urlMap.set(source.url, source);
    }

    // Cloud sources override local
    for (const source of cloudSources) {
        urlMap.set(source.url, source);
    }

    // Sort by addedAt descending
    return Array.from(urlMap.values()).sort((a, b) => b.addedAt - a.addedAt);
};

// ==================== Favorites ====================
const FAVORITES_COLLECTION = 'sheetmind_favorites';

export interface CloudFavoriteItem {
    id: string;
    imageUrl: string;
    rowData: Record<string, unknown>;
    addedAt: number;
}

/**
 * Save all favorites to Firebase (replaces existing)
 */
export const saveFavoritesToCloud = async (favorites: CloudFavoriteItem[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, FAVORITES_COLLECTION, userId);
    await setDoc(docRef, {
        favorites,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load favorites from Firebase
 */
export const loadFavoritesFromCloud = async (): Promise<CloudFavoriteItem[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const docRef = doc(db, FAVORITES_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().favorites || [];
    }
    return [];
};

/**
 * Add a single favorite to cloud (merges with existing)
 */
export const addFavoriteToCloud = async (favorite: CloudFavoriteItem): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    // Load existing, add new, save back
    const existing = await loadFavoritesFromCloud();
    const updated = [favorite, ...existing.filter(f => f.imageUrl !== favorite.imageUrl)];
    await saveFavoritesToCloud(updated);
};

/**
 * Remove a favorite from cloud
 */
export const removeFavoriteFromCloud = async (imageUrl: string): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const existing = await loadFavoritesFromCloud();
    const updated = existing.filter(f => f.imageUrl !== imageUrl);
    await saveFavoritesToCloud(updated);
};

// ==================== Sheet Data ====================

/**
 * Save sheet data to Firebase
 */
export const saveSheetDataToCloud = async (data: {
    name: string;
    columns: string[];
    rows: Record<string, unknown>[];
    source?: 'paste' | 'sheets' | 'csv';
    sheetsUrl?: string;
}): Promise<string> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const id = Date.now().toString();
    const docRef = doc(db, DATA_COLLECTION, `${userId}_${id}`);
    await setDoc(docRef, {
        id,
        ...data,
        userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    return id;
};

/**
 * Load all saved sheet data for current user
 */
export const loadSheetDataFromCloud = async (): Promise<CloudSheetData[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const q = query(
        collection(db, DATA_COLLECTION),
        where('userId', '==', userId),
        orderBy('updatedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        ...doc.data()
    } as CloudSheetData));
};

/**
 * Delete sheet data from Firebase
 */
export const deleteSheetDataFromCloud = async (dataId: string): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, DATA_COLLECTION, `${userId}_${dataId}`);
    await deleteDoc(docRef);
};

// ==================== Google Sheets Integration ====================

/**
 * Fetch data from Google Sheets using Sheets API
 * Requires OAuth access token with spreadsheets.readonly scope
 */
export const fetchGoogleSheetsData = async (
    spreadsheetId: string,
    sheetName: string = 'Sheet1',
    accessToken: string
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> => {
    const range = encodeURIComponent(`${sheetName}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error(`Google Sheets API 错误: ${response.status}`);
    }

    const data = await response.json();
    const values: string[][] = data.values || [];

    if (values.length === 0) {
        return { columns: [], rows: [] };
    }

    // First row is headers
    const columns = values[0];
    const rows = values.slice(1).map(row => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col, idx) => {
            obj[col] = row[idx] || '';
        });
        return obj;
    });

    return { columns, rows };
};

/**
 * Parse Google Sheets URL to extract spreadsheet ID and sheet name
 */
export const parseGoogleSheetsUrl = (url: string): { spreadsheetId: string; sheetName?: string } | null => {
    // Format: https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit#gid=0
    const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return null;

    const spreadsheetId = match[1];

    // Try to extract sheet name from gid (would need additional API call)
    return { spreadsheetId };
};

/**
 * Create a new sheet (tab) in a Google Spreadsheet
 */
export const createSheetTab = async (
    spreadsheetId: string,
    sheetName: string,
    accessToken: string
): Promise<number> => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            requests: [{
                addSheet: {
                    properties: {
                        title: sheetName
                    }
                }
            }]
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`创建分页失败: ${error.error?.message || response.status}`);
    }

    const result = await response.json();
    return result.replies[0].addSheet.properties.sheetId;
};

/**
 * Write data to a specific sheet in Google Spreadsheet
 * Data format: 2D array where first row is headers
 */
export const writeToGoogleSheet = async (
    spreadsheetId: string,
    sheetName: string,
    data: (string | number | null)[][],
    accessToken: string
): Promise<void> => {
    const range = encodeURIComponent(`${sheetName}!A1`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            values: data
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`写入数据失败: ${error.error?.message || response.status}`);
    }
};

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

const formatSheetName = (name: string): string => {
    const escaped = name.replace(/'/g, "''");
    return /[\s]/.test(escaped) ? `'${escaped}'` : escaped;
};

const fetchSheetMeta = async (
    spreadsheetId: string,
    sheetName: string,
    accessToken: string
): Promise<{ sheetId: number; rowCount: number; columnCount: number } | null> => {
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
    const metaResponse = await fetch(metaUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!metaResponse.ok) {
        if (metaResponse.status === 401) {
            throw new Error('Google 认证已过期，请重新登录。');
        }
        if (metaResponse.status === 403) {
            throw new Error('没有权限访问此表格。请确保已共享给当前账号。');
        }
        throw new Error(`读取表格信息失败: ${metaResponse.status}`);
    }

    const metaData = await metaResponse.json();
    const sheet = metaData.sheets?.find((s: { properties: { title: string } }) => s.properties.title === sheetName);
    if (!sheet) return null;

    const props = sheet.properties || {};
    return {
        sheetId: props.sheetId,
        rowCount: props.gridProperties?.rowCount || 0,
        columnCount: props.gridProperties?.columnCount || 0
    };
};

const ensureSheetGridSize = async (
    spreadsheetId: string,
    sheetId: number,
    targetRows: number,
    targetColumns: number,
    accessToken: string
): Promise<void> => {
    const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    const response = await fetch(batchUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            requests: [{
                updateSheetProperties: {
                    properties: {
                        sheetId,
                        gridProperties: {
                            rowCount: targetRows,
                            columnCount: targetColumns
                        }
                    },
                    fields: 'gridProperties.rowCount,gridProperties.columnCount'
                }
            }]
        })
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`扩展表格大小失败: ${error.error?.message || response.status}`);
    }
};

const clearGoogleSheet = async (
    spreadsheetId: string,
    sheetName: string,
    accessToken: string
): Promise<void> => {
    const range = encodeURIComponent(formatSheetName(sheetName));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`清空表格失败: ${error.error?.message || response.status}`);
    }
};

const writeToGoogleSheetRange = async (
    spreadsheetId: string,
    sheetName: string,
    startRow: number,
    values: (string | number | boolean | null)[][],
    accessToken: string
): Promise<void> => {
    const maxColumns = values.reduce((max, row) => Math.max(max, row.length), 0);
    const endCol = columnIndexToLetter(Math.max(1, maxColumns));
    const endRow = startRow + values.length - 1;
    const range = encodeURIComponent(`${formatSheetName(sheetName)}!A${startRow}:${endCol}${endRow}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`写入数据失败: ${error.error?.message || response.status}`);
    }
};

export const overwriteGoogleSheetData = async (
    spreadsheetId: string,
    sheetName: string,
    rows: (string | number | boolean | null)[][],
    accessToken: string,
    options?: { chunkSize?: number; onProgress?: (writtenRows: number, totalRows: number) => void }
): Promise<void> => {
    const safeSheetName = sheetName.trim() || 'Sheet1';
    let sheetMeta = await fetchSheetMeta(spreadsheetId, safeSheetName, accessToken);

    if (!sheetMeta) {
        const sheetId = await createSheetTab(spreadsheetId, safeSheetName, accessToken);
        sheetMeta = {
            sheetId,
            rowCount: 0,
            columnCount: 0
        };
    }

    const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const targetRows = Math.max(rows.length, 1);
    const targetColumns = Math.max(maxColumns, 1);

    if (sheetMeta.rowCount < targetRows || sheetMeta.columnCount < targetColumns) {
        await ensureSheetGridSize(
            spreadsheetId,
            sheetMeta.sheetId,
            Math.max(sheetMeta.rowCount, targetRows),
            Math.max(sheetMeta.columnCount, targetColumns),
            accessToken
        );
    }

    await clearGoogleSheet(spreadsheetId, safeSheetName, accessToken);

    if (rows.length === 0) return;

    const chunkSize = options?.chunkSize ?? 2000;
    let written = 0;

    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const startRow = i + 1;
        await writeToGoogleSheetRange(spreadsheetId, safeSheetName, startRow, chunk, accessToken);
        written += chunk.length;
        if (options?.onProgress) {
            options.onProgress(written, rows.length);
        }
    }
};

/**
 * Create a new sheet tab and write transpose data to it
 * This is the main function for syncing versions to Google Sheets
 */
export const syncVersionToGoogleSheet = async (
    spreadsheetId: string,
    versionName: string,
    transposeData: { label: string; data: (string | number | null)[] }[],
    accessToken: string
): Promise<{ sheetId: number; sheetName: string }> => {
    // Clean sheet name: remove all special chars that Google Sheets can't handle
    // Including: / \ ? * [ ] : ' ( ) → and limit to 100 chars
    const cleanName = versionName
        .replace(/[\/\\?*[\]:'"()→←↔]/g, '_')
        .replace(/_+/g, '_')  // collapse multiple underscores
        .replace(/^_|_$/g, '') // trim leading/trailing underscores
        .slice(0, 100) || 'Sheet';

    // Try to create the sheet tab
    let sheetId: number;
    let actualSheetName = cleanName;
    try {
        sheetId = await createSheetTab(spreadsheetId, cleanName, accessToken);
    } catch (err: unknown) {
        // If sheet already exists, append timestamp
        actualSheetName = `${cleanName}_${Date.now().toString().slice(-6)}`;
        sheetId = await createSheetTab(spreadsheetId, actualSheetName, accessToken);
    }

    // Prepare data for writing - HORIZONTAL format matching software display:
    // Each outputPlan item = one row
    // First column = label (row header)
    // Following columns = data values
    const writeData: (string | number | null)[][] = [];

    // Each row: [label, data[0], data[1], data[2], ...]
    for (const item of transposeData) {
        writeData.push([item.label, ...item.data]);
    }

    // Write the data
    await writeToGoogleSheet(spreadsheetId, actualSheetName, writeData, accessToken);

    return { sheetId, sheetName: actualSheetName };
};

/**
 * Check if user is logged in
 */
export const isUserLoggedIn = (): boolean => {
    return !!auth.currentUser;
};

/**
 * Get current user display name
 */
export const getCurrentUserName = (): string | null => {
    return auth.currentUser?.displayName || auth.currentUser?.email || null;
};

/**
 * Get user's Google OAuth access token (for Sheets API)
 */
export const getGoogleAccessToken = async (): Promise<string | null> => {
    const user = auth.currentUser;
    if (!user) return null;

    // Get the token from the current user's credential
    // Note: This requires the user to have signed in with Google
    try {
        const token = await user.getIdToken();
        return token;
    } catch {
        return null;
    }
};

// ==================== Display Settings ====================
const DISPLAY_SETTINGS_COLLECTION = 'sheetmind_display_settings';

export interface CloudDisplaySettings {
    // TransposePanel settings
    thumbnailSize?: number;
    normalRowHeight?: number;
    cellWidth?: number;
    borderWidth?: number;
    borderColor?: string;
    columnRowHeights?: Record<string, number>;
    // MediaGalleryPanel settings
    galleryThumbnailSize?: number;
    matrixCellWidth?: number;
    scrollCardWidth?: number;
    calendarCellHeight?: number;
    galleryPageSize?: number;
}

/**
 * Save display settings to Firebase
 */
export const saveDisplaySettingsToCloud = async (settings: CloudDisplaySettings): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, DISPLAY_SETTINGS_COLLECTION, userId);
    await setDoc(docRef, {
        ...settings,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

/**
 * Load display settings from Firebase
 */
export const loadDisplaySettingsFromCloud = async (): Promise<CloudDisplaySettings | null> => {
    const userId = getUserId();
    if (!userId) return null;

    const docRef = doc(db, DISPLAY_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data() as CloudDisplaySettings;
    }
    return null;
};

// ==================== Highlight Rules ====================
const HIGHLIGHT_RULES_COLLECTION = 'sheetmind_highlight_rules';

export interface CloudHighlightRule {
    id: string;
    column: string;
    operator: string;
    value: string;
    value2?: string;
    color: string;
    borderWidth?: number;
    enabled?: boolean;
}

/**
 * Save transpose highlight rules to Firebase
 */
export const saveTransposeHighlightRulesToCloud = async (rules: CloudHighlightRule[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, HIGHLIGHT_RULES_COLLECTION, `${userId}_transpose`);
    await setDoc(docRef, {
        rules,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load transpose highlight rules from Firebase
 */
export const loadTransposeHighlightRulesFromCloud = async (): Promise<CloudHighlightRule[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const docRef = doc(db, HIGHLIGHT_RULES_COLLECTION, `${userId}_transpose`);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().rules || [];
    }
    return [];
};

/**
 * Save gallery highlight rules to Firebase
 */
export const saveGalleryHighlightRulesToCloud = async (rules: CloudHighlightRule[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, HIGHLIGHT_RULES_COLLECTION, `${userId}_gallery`);
    await setDoc(docRef, {
        rules,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load gallery highlight rules from Firebase
 */
export const loadGalleryHighlightRulesFromCloud = async (): Promise<CloudHighlightRule[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const docRef = doc(db, HIGHLIGHT_RULES_COLLECTION, `${userId}_gallery`);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().rules || [];
    }
    return [];
};

// ==================== Gallery Config ====================
const GALLERY_CONFIG_COLLECTION = 'sheetmind_gallery_config';

/**
 * Save current gallery config to Firebase
 */
export const saveGalleryConfigToCloud = async (config: Record<string, unknown>): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, GALLERY_CONFIG_COLLECTION, userId);
    await setDoc(docRef, {
        config,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load current gallery config from Firebase
 */
export const loadGalleryConfigFromCloud = async (): Promise<Record<string, unknown> | null> => {
    const userId = getUserId();
    if (!userId) return null;

    const docRef = doc(db, GALLERY_CONFIG_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().config || null;
    }
    return null;
};

// ==================== Dashboard Snapshots ====================
const SNAPSHOTS_COLLECTION = 'sheetmind_snapshots';

export interface CloudChartSnapshot {
    id: string;
    title: string;
    type: string;
    data: unknown[];
    breakdownKeys: string[];
    aggregation: string;
    metricLabel: string;
    isStacked: boolean;
    xAxisLabel: string;
    createdAt?: number;
}

/**
 * Save dashboard snapshots to Firebase
 */
export const saveSnapshotsToCloud = async (snapshots: CloudChartSnapshot[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, SNAPSHOTS_COLLECTION, userId);
    await setDoc(docRef, {
        snapshots,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load dashboard snapshots from Firebase
 */
export const loadSnapshotsFromCloud = async (): Promise<CloudChartSnapshot[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const docRef = doc(db, SNAPSHOTS_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().snapshots || [];
    }
    return [];
};

/**
 * Add a snapshot to cloud (merges with existing)
 */
export const addSnapshotToCloud = async (snapshot: CloudChartSnapshot): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const existing = await loadSnapshotsFromCloud();
    const updated = [snapshot, ...existing.filter(s => s.id !== snapshot.id)];
    await saveSnapshotsToCloud(updated);
};

/**
 * Remove a snapshot from cloud
 */
export const removeSnapshotFromCloud = async (snapshotId: string): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const existing = await loadSnapshotsFromCloud();
    const updated = existing.filter(s => s.id !== snapshotId);
    await saveSnapshotsToCloud(updated);
};

// ==================== Dashboard Bins Preset ====================
const DASHBOARD_BINS_COLLECTION = 'sheetmind_dashboard_bins';

export interface BinRange {
    id: string;
    label: string;
    min: number;
    max: number;
}

export interface DashboardBinsPreset {
    rowBins: BinRange[];
    colBins: BinRange[];
}

/**
 * Save dashboard bins preset to Firebase
 */
export const saveDashboardBinsToCloud = async (preset: DashboardBinsPreset): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, DASHBOARD_BINS_COLLECTION, userId);
    await setDoc(docRef, {
        ...preset,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load dashboard bins preset from Firebase
 */
export const loadDashboardBinsFromCloud = async (): Promise<DashboardBinsPreset | null> => {
    const userId = getUserId();
    if (!userId) return null;

    const docRef = doc(db, DASHBOARD_BINS_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        return {
            rowBins: data.rowBins || [],
            colBins: data.colBins || []
        };
    }
    return null;
};

// ==================== Gallery Saved Configs ====================
const GALLERY_SAVED_CONFIGS_COLLECTION = 'sheetmind_gallery_saved_configs';

export interface SavedGalleryConfig {
    id: string;
    name: string;
    config: Record<string, unknown>;
    createdAt: number;
}

/**
 * Save gallery saved configs to Firebase
 */
export const saveGallerySavedConfigsToCloud = async (configs: SavedGalleryConfig[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, GALLERY_SAVED_CONFIGS_COLLECTION, userId);
    await setDoc(docRef, {
        configs,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load gallery saved configs from Firebase
 */
export const loadGallerySavedConfigsFromCloud = async (): Promise<SavedGalleryConfig[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const docRef = doc(db, GALLERY_SAVED_CONFIGS_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().configs || [];
    }
    return [];
};

// ==================== Gallery Current Config ====================
const GALLERY_CURRENT_CONFIG_COLLECTION = 'sheetmind_gallery_current_config';

/**
 * Save current gallery config to Firebase
 */
export const saveCurrentGalleryConfigToCloud = async (config: Record<string, unknown>): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, GALLERY_CURRENT_CONFIG_COLLECTION, userId);
    await setDoc(docRef, {
        config,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load current gallery config from Firebase
 */
export const loadCurrentGalleryConfigFromCloud = async (): Promise<Record<string, unknown> | null> => {
    const userId = getUserId();
    if (!userId) return null;

    const docRef = doc(db, GALLERY_CURRENT_CONFIG_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().config || null;
    }
    return null;
};

// ==================== Gallery Notes (备注) ====================
const GALLERY_NOTES_COLLECTION = 'sheetmind_gallery_notes';

export interface GalleryNote {
    id: string;           // Unique ID (based on image URL hash)
    imageUrl: string;     // Image URL as identifier
    note: string;         // User's note content
    rowIndex: number;     // Original row index in the spreadsheet (1-indexed, excluding header)
    spreadsheetId?: string; // Optional: for syncing back to Google Sheets
    sheetName?: string;   // Optional: sheet name for syncing
    createdAt: number;    // Timestamp
    updatedAt: number;    // Last update timestamp
}

/**
 * Save all gallery notes to Firebase (replaces existing)
 */
export const saveGalleryNotesToCloud = async (notes: GalleryNote[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, GALLERY_NOTES_COLLECTION, userId);
    await setDoc(docRef, {
        notes,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load gallery notes from Firebase
 */
export const loadGalleryNotesFromCloud = async (): Promise<GalleryNote[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const docRef = doc(db, GALLERY_NOTES_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().notes || [];
    }
    return [];
};

/**
 * Add or update a single gallery note
 */
export const upsertGalleryNoteToCloud = async (note: GalleryNote): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const existing = await loadGalleryNotesFromCloud();
    const index = existing.findIndex(n => n.imageUrl === note.imageUrl);

    if (index >= 0) {
        existing[index] = { ...existing[index], ...note, updatedAt: Date.now() };
    } else {
        existing.push(note);
    }

    await saveGalleryNotesToCloud(existing);
};

/**
 * Delete a gallery note by image URL
 */
export const deleteGalleryNoteFromCloud = async (imageUrl: string): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const existing = await loadGalleryNotesFromCloud();
    const filtered = existing.filter(n => n.imageUrl !== imageUrl);
    await saveGalleryNotesToCloud(filtered);
};

/**
 * Convert column letter to number (A=1, B=2, ..., Z=26, AA=27, etc.)
 */
const columnLetterToNumber = (col: string): number => {
    let num = 0;
    for (let i = 0; i < col.length; i++) {
        num = num * 26 + (col.charCodeAt(i) - 64);
    }
    return num;
};

/**
 * Expand sheet columns if needed
 */
const expandSheetColumns = async (
    spreadsheetId: string,
    sheetName: string,
    targetColumn: string,
    accessToken: string
): Promise<void> => {
    const targetColNum = columnLetterToNumber(targetColumn.toUpperCase());

    // First, get the sheet ID and current properties
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties))`;
    const metaResponse = await fetch(metaUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!metaResponse.ok) return;

    const metaData = await metaResponse.json();
    const sheet = metaData.sheets?.find((s: { properties: { title: string } }) => s.properties.title === sheetName);
    if (!sheet) return;

    const sheetId = sheet.properties.sheetId;
    const currentCols = sheet.properties.gridProperties?.columnCount || 26;

    if (currentCols >= targetColNum) return; // Already enough columns

    // Expand columns using batchUpdate
    const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    await fetch(batchUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            requests: [{
                updateSheetProperties: {
                    properties: {
                        sheetId,
                        gridProperties: { columnCount: targetColNum + 5 } // Add some buffer
                    },
                    fields: 'gridProperties.columnCount'
                }
            }]
        })
    });

};

/**
 * Update a single cell in Google Spreadsheet
 * @param spreadsheetId - The spreadsheet ID
 * @param sheetName - The sheet (tab) name
 * @param column - Column letter (e.g., 'R')
 * @param row - Row number (1-indexed)
 * @param value - The value to write
 * @param accessToken - Google OAuth access token
 */
export const updateSingleCellInGoogleSheet = async (
    spreadsheetId: string,
    sheetName: string,
    column: string,
    row: number,
    value: string,
    accessToken: string
): Promise<void> => {
    const range = encodeURIComponent(`${sheetName}!${column}${row}`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;

    const tryWrite = async (): Promise<Response> => {
        return fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                values: [[value]]
            })
        });
    };

    let response = await tryWrite();

    // If failed due to grid limits, try to expand columns and retry
    if (!response.ok) {
        const error = await response.json();
        if (error.error?.message?.includes('exceeds grid limits') || error.error?.message?.includes('Max columns')) {
            await expandSheetColumns(spreadsheetId, sheetName, column, accessToken);
            response = await tryWrite();

            if (!response.ok) {
                const retryError = await response.json();
                throw new Error(`写入单元格失败: ${retryError.error?.message || response.status}`);
            }
            return;
        }
        throw new Error(`写入单元格失败: ${error.error?.message || response.status}`);
    }
};

/**
 * Ensure notes/categories columns exist at A/B.
 * If A/B already contain other headers, insert two columns to the left.
 */
export const ensureNotesAndCategoriesColumns = async (
    spreadsheetId: string,
    sheetName: string,
    accessToken: string
): Promise<void> => {
    const noteHeader = '备注';
    const categoryHeader = '媒体标签';

    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
    const metaResponse = await fetch(metaUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!metaResponse.ok) {
        throw new Error(`读取表格元数据失败: ${metaResponse.status}`);
    }

    const metaData = await metaResponse.json();
    const sheet = metaData.sheets?.find((s: { properties: { title: string } }) => s.properties.title === sheetName);
    if (!sheet) {
        throw new Error(`找不到表格分页: ${sheetName}`);
    }

    const headerRange = encodeURIComponent(`${sheetName}!A1:B1`);
    const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${headerRange}`;
    const headerResponse = await fetch(headerUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!headerResponse.ok) {
        throw new Error(`读取表头失败: ${headerResponse.status}`);
    }

    const headerData = await headerResponse.json();
    const headerRow: string[] = headerData.values?.[0] || [];
    const headerA = String(headerRow[0] || '').trim();
    const headerB = String(headerRow[1] || '').trim();

    const noteHeaderMatch = headerA === noteHeader || headerA.toLowerCase() === 'notes';
    const categoryHeaderMatch =
        headerB === categoryHeader || headerB === '分类' || headerB.toLowerCase() === 'category';

    if (noteHeaderMatch && categoryHeaderMatch) return;

    let shouldInsert = (headerA !== '' && !noteHeaderMatch) || (headerB !== '' && !categoryHeaderMatch);
    if (!shouldInsert && (!noteHeaderMatch || !categoryHeaderMatch)) {
        const row2Range = encodeURIComponent(`${sheetName}!A2:B2`);
        const row2Url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${row2Range}`;
        const row2Response = await fetch(row2Url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!row2Response.ok) {
            throw new Error(`读取表格内容失败: ${row2Response.status}`);
        }
        const row2Data = await row2Response.json();
        const row2: string[] = row2Data.values?.[0] || [];
        const row2A = String(row2[0] || '').trim();
        const row2B = String(row2[1] || '').trim();
        if ((!noteHeaderMatch && row2A !== '') || (!categoryHeaderMatch && row2B !== '')) {
            shouldInsert = true;
        }
    }
    if (shouldInsert) {
        const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
        const insertResponse = await fetch(batchUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                requests: [{
                    insertDimension: {
                        range: {
                            sheetId: sheet.properties.sheetId,
                            dimension: 'COLUMNS',
                            startIndex: 0,
                            endIndex: 2
                        },
                        inheritFromBefore: false
                    }
                }]
            })
        });
        if (!insertResponse.ok) {
            const error = await insertResponse.json();
            throw new Error(`插入列失败: ${error.error?.message || insertResponse.status}`);
        }
    }

    await updateSingleCellInGoogleSheet(spreadsheetId, sheetName, 'A', 1, noteHeader, accessToken);
    await updateSingleCellInGoogleSheet(spreadsheetId, sheetName, 'B', 1, categoryHeader, accessToken);
};

// ==================== Gallery Categories (分类) ====================
const GALLERY_CATEGORIES_COLLECTION = 'sheetmind_gallery_categories';

export interface GalleryCategory {
    id: string;           // Unique ID (based on image URL hash)
    imageUrl: string;     // Image URL as identifier
    category: string;     // Category value
    createdAt: number;    // Timestamp
    updatedAt: number;    // Last update timestamp
}

/**
 * Save all gallery categories to Firebase (replaces existing)
 */
export const saveGalleryCategoriesToCloud = async (categories: GalleryCategory[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, GALLERY_CATEGORIES_COLLECTION, userId);
    await setDoc(docRef, {
        categories,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load gallery categories from Firebase
 */
export const loadGalleryCategoriesFromCloud = async (): Promise<GalleryCategory[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const docRef = doc(db, GALLERY_CATEGORIES_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().categories || [];
    }
    return [];
};

/**
 * Add or update a single gallery category
 */
export const upsertGalleryCategoryToCloud = async (category: GalleryCategory): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const existing = await loadGalleryCategoriesFromCloud();
    const index = existing.findIndex(c => c.imageUrl === category.imageUrl);

    if (index >= 0) {
        existing[index] = { ...existing[index], ...category, updatedAt: Date.now() };
    } else {
        existing.push(category);
    }

    await saveGalleryCategoriesToCloud(existing);
};

/**
 * Delete a gallery category by image URL
 */
export const deleteGalleryCategoryFromCloud = async (imageUrl: string): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const existing = await loadGalleryCategoriesFromCloud();
    const filtered = existing.filter(c => c.imageUrl !== imageUrl);
    await saveGalleryCategoriesToCloud(filtered);
};

// ==================== Image Recognition Presets (Global) ====================
const RECOGNITION_PRESETS_COLLECTION = 'recognition_presets';

export interface RecognitionPreset {
    id: string;
    name: string;
    text: string;
    createdAt?: number;
}

/**
 * Save recognition presets to Firebase (global, cross-project)
 */
export const saveRecognitionPresetsToCloud = async (presets: RecognitionPreset[]): Promise<void> => {
    const userId = getUserId();
    if (!userId) throw new Error('用户未登录');

    const docRef = doc(db, RECOGNITION_PRESETS_COLLECTION, userId);
    await setDoc(docRef, {
        presets,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load recognition presets from Firebase
 */
export const loadRecognitionPresetsFromCloud = async (): Promise<RecognitionPreset[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const docRef = doc(db, RECOGNITION_PRESETS_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().presets || [];
    }
    return [];
};
