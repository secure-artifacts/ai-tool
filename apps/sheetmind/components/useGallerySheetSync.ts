import { useState, useCallback, useEffect } from 'react';
import { parseGoogleSheetsUrl, ensureNotesAndCategoriesColumns, updateSingleCellInGoogleSheet } from '../services/firebaseService';
import { getGoogleAccessToken } from '@/services/authService';
import { DataRow } from '../types';
import { extractImageUrl, NOTE_COLUMN, CATEGORY_COLUMN } from './galleryUtils';

export function useGallerySheetSync(
    sourceUrl: string,
    currentSheetName: string | null,
    galleryNotes: Map<string, { rowIndex: number; note: string }>,
    galleryCategories: Map<string, string>,
    effectiveData: { rows: DataRow[], columns: string[] },
    imageColumn: string,
    autoSyncNotesToSheet: boolean,
    autoSyncCategoriesToSheet: boolean,
    setFeedback: (msg: string | null) => void
) {
    const [isBatchSyncing, setIsBatchSyncing] = useState(false);
    const [isBatchCategorySyncing, setIsBatchCategorySyncing] = useState(false);

    const syncAllNotesToSheet = useCallback(async () => {
        if (!sourceUrl || !currentSheetName) {
            setFeedback('⚠️ 未连接 Google 表格');
            setTimeout(() => setFeedback(null), 2000);
            return;
        }

        const accessToken = getGoogleAccessToken();
        if (!accessToken) {
            setFeedback('⚠️ 请先登录 Google 账号');
            setTimeout(() => setFeedback(null), 2000);
            return;
        }

        const notesToSync = Array.from(galleryNotes.values()).filter(note =>
            note.note && note.rowIndex > 0
        );

        if (notesToSync.length === 0) {
            setFeedback('没有备注需要同步');
            setTimeout(() => setFeedback(null), 1500);
            return;
        }

        setIsBatchSyncing(true);
        setFeedback(`⏳ 正在同步 ${notesToSync.length} 条备注...`);

        try {
            const parsed = parseGoogleSheetsUrl(sourceUrl);
            if (!parsed?.spreadsheetId) {
                throw new Error('无法解析表格 ID');
            }

            let successCount = 0;
            let failCount = 0;

            await ensureNotesAndCategoriesColumns(
                parsed.spreadsheetId,
                currentSheetName,
                accessToken
            );

            for (const note of notesToSync) {
                try {
                    await updateSingleCellInGoogleSheet(
                        parsed.spreadsheetId,
                        currentSheetName,
                        NOTE_COLUMN,
                        note.rowIndex,
                        note.note,
                        accessToken
                    );
                    successCount++;
                    setFeedback(`⏳ 同步中... (${successCount}/${notesToSync.length})`);
                } catch (err) {
                    console.error(`[Notes] Failed to sync row ${note.rowIndex}:`, err);
                    failCount++;
                }
            }

            if (failCount === 0) {
                setFeedback(`✅ 已同步 ${successCount} 条备注到 ${NOTE_COLUMN} 列`);
            } else {
                setFeedback(`⚠️ 同步完成: ${successCount} 成功, ${failCount} 失败`);
            }
            setTimeout(() => setFeedback(null), 3000);
        } catch (err) {
            console.error('[Notes] Batch sync failed:', err);
            setFeedback('❌ 同步失败: ' + (err instanceof Error ? err.message : '未知错误'));
            setTimeout(() => setFeedback(null), 3000);
        } finally {
            setIsBatchSyncing(false);
        }
    }, [sourceUrl, currentSheetName, galleryNotes, setFeedback]);

    const syncAllCategoriesToSheet = useCallback(async () => {
        if (!sourceUrl || !currentSheetName) {
            setFeedback('⚠️ 未连接 Google 表格');
            setTimeout(() => setFeedback(null), 2000);
            return;
        }

        const accessToken = getGoogleAccessToken();
        if (!accessToken) {
            setFeedback('⚠️ 请先登录 Google 账号');
            setTimeout(() => setFeedback(null), 2000);
            return;
        }

        const imageUrlToRowIndex = new Map<string, number>();
        effectiveData.rows.forEach((row, idx) => {
            const imageUrl = extractImageUrl(row[imageColumn]);
            if (imageUrl) {
                imageUrlToRowIndex.set(imageUrl, idx + 2);
            }
        });

        const categoriesToSync: { imageUrl: string; category: string; rowIndex: number }[] = [];
        galleryCategories.forEach((category, imageUrl) => {
            const rowIndex = imageUrlToRowIndex.get(imageUrl);
            if (category && rowIndex) {
                categoriesToSync.push({ imageUrl, category, rowIndex });
            }
        });

        if (categoriesToSync.length === 0) {
            if (galleryCategories.size === 0) {
                setFeedback('⚠️ 请先为图片设置分类（点击图片左侧的标签图标）');
            } else {
                setFeedback('⚠️ 没有分类匹配到当前表格的图片');
            }
            setTimeout(() => setFeedback(null), 3000);
            return;
        }

        setIsBatchCategorySyncing(true);
        setFeedback(`⏳ 正在同步 ${categoriesToSync.length} 条分类...`);

        try {
            const parsed = parseGoogleSheetsUrl(sourceUrl);
            if (!parsed?.spreadsheetId) {
                throw new Error('无法解析表格 ID');
            }

            let successCount = 0;
            let failCount = 0;

            await ensureNotesAndCategoriesColumns(
                parsed.spreadsheetId,
                currentSheetName,
                accessToken
            );

            for (const item of categoriesToSync) {
                try {
                    await updateSingleCellInGoogleSheet(
                        parsed.spreadsheetId,
                        currentSheetName,
                        CATEGORY_COLUMN,
                        item.rowIndex,
                        item.category,
                        accessToken
                    );
                    successCount++;
                    setFeedback(`⏳ 同步中... (${successCount}/${categoriesToSync.length})`);
                } catch (err) {
                    console.error(`[Categories] Failed to sync row ${item.rowIndex}:`, err);
                    failCount++;
                }
            }

            if (failCount === 0) {
                setFeedback(`✅ 已同步 ${successCount} 条分类到 ${CATEGORY_COLUMN} 列`);
            } else {
                setFeedback(`⚠️ 同步完成: ${successCount} 成功, ${failCount} 失败`);
            }
            setTimeout(() => setFeedback(null), 3000);
        } catch (err) {
            console.error('[Categories] Batch sync failed:', err);
            setFeedback('❌ 同步失败: ' + (err instanceof Error ? err.message : '未知错误'));
            setTimeout(() => setFeedback(null), 3000);
        } finally {
            setIsBatchCategorySyncing(false);
        }
    }, [sourceUrl, currentSheetName, galleryCategories, effectiveData.rows, imageColumn, setFeedback]);

    // Sync grouping/classification results to a user-selected column
    const [isBatchGroupSyncing, setIsBatchGroupSyncing] = useState(false);

    const syncGroupingToSheet = useCallback(async (
        targetColumn: string,
        groupMapping: Map<string, { rowIndex: number; group: string }>
    ) => {
        if (!sourceUrl || !currentSheetName) {
            setFeedback('⚠️ 未连接 Google 表格');
            setTimeout(() => setFeedback(null), 2000);
            return;
        }

        const accessToken = getGoogleAccessToken();
        if (!accessToken) {
            setFeedback('⚠️ 请先登录 Google 账号');
            setTimeout(() => setFeedback(null), 2000);
            return;
        }

        const itemsToSync = Array.from(groupMapping.values()).filter(item =>
            item.group && item.rowIndex > 0
        );

        if (itemsToSync.length === 0) {
            setFeedback('⚠️ 没有分组数据需要同步');
            setTimeout(() => setFeedback(null), 2000);
            return;
        }

        setIsBatchGroupSyncing(true);
        setFeedback(`⏳ 正在写入 ${itemsToSync.length} 条分组到 ${targetColumn} 列...`);

        try {
            const parsed = parseGoogleSheetsUrl(sourceUrl);
            if (!parsed?.spreadsheetId) {
                throw new Error('无法解析表格 ID');
            }

            let successCount = 0;
            let failCount = 0;

            for (const item of itemsToSync) {
                try {
                    await updateSingleCellInGoogleSheet(
                        parsed.spreadsheetId,
                        currentSheetName,
                        targetColumn,
                        item.rowIndex,
                        item.group,
                        accessToken
                    );
                    successCount++;
                    if (successCount % 5 === 0 || successCount === itemsToSync.length) {
                        setFeedback(`⏳ 写入中... (${successCount}/${itemsToSync.length})`);
                    }
                } catch (err) {
                    console.error(`[Grouping] Failed to sync row ${item.rowIndex}:`, err);
                    failCount++;
                }
            }

            if (failCount === 0) {
                setFeedback(`✅ 已写入 ${successCount} 条分组到 ${targetColumn} 列`);
            } else {
                setFeedback(`⚠️ 写入完成: ${successCount} 成功, ${failCount} 失败`);
            }
            setTimeout(() => setFeedback(null), 3000);
        } catch (err) {
            console.error('[Grouping] Batch sync failed:', err);
            setFeedback('❌ 写入失败: ' + (err instanceof Error ? err.message : '未知错误'));
            setTimeout(() => setFeedback(null), 3000);
        } finally {
            setIsBatchGroupSyncing(false);
        }
    }, [sourceUrl, currentSheetName, setFeedback]);

    useEffect(() => {
        if (autoSyncNotesToSheet && galleryNotes.size > 0 && !isBatchSyncing) {
            syncAllNotesToSheet();
        }
    }, [autoSyncNotesToSheet, galleryNotes.size, isBatchSyncing, syncAllNotesToSheet]);

    useEffect(() => {
        if (autoSyncCategoriesToSheet && galleryCategories.size > 0 && !isBatchCategorySyncing) {
            syncAllCategoriesToSheet();
        }
    }, [autoSyncCategoriesToSheet, galleryCategories.size, isBatchCategorySyncing, syncAllCategoriesToSheet]);

    return {
        syncAllNotesToSheet,
        syncAllCategoriesToSheet,
        syncGroupingToSheet,
        isBatchSyncing,
        isBatchCategorySyncing,
        isBatchGroupSyncing
    };
}
