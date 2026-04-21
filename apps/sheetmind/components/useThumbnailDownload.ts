import { useState, useCallback } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DataRow } from '../types';
import { extractImageUrl } from './galleryUtils';

export function useThumbnailDownload() {
    const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number; status: string } | null>(null);
    const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);

    const downloadAllThumbnails = useCallback(async (
        processedRows: DataRow[],
        effectiveImageColumn: string,
        primaryGroupColumn: string
    ) => {
        if (!effectiveImageColumn) {
            setDownloadFeedback('⚠️ 请先配置图片列');
            setTimeout(() => setDownloadFeedback(null), 3000);
            return;
        }

        const allImages: { url: string; group: string; index: number }[] = [];

        processedRows.forEach((row, idx) => {
            const imageUrl = extractImageUrl(row[effectiveImageColumn]);
            if (!imageUrl) return;
            const group = primaryGroupColumn
                ? String(row[primaryGroupColumn] || '未分组').replace(/[\/\\:*?"<>|]/g, '_')
                : '';
            allImages.push({ url: imageUrl, group, index: idx });
        });

        if (allImages.length === 0) {
            setDownloadFeedback('⚠️ 没有找到可下载的图片');
            setTimeout(() => setDownloadFeedback(null), 3000);
            return;
        }

        if (!window.confirm(`确定下载 ${allImages.length} 张缩略图？\n${primaryGroupColumn ? '将按分组建立子文件夹' : '所有图片在同一目录'}`)) {
            return;
        }

        const zip = new JSZip();
        let completed = 0;
        let failed = 0;
        const total = allImages.length;
        const concurrency = 4;

        setDownloadProgress({ current: 0, total, status: '准备下载...' });

        const groupCounters: Record<string, number> = {};
        const inElectron = !!(window as any).electronCache?.isElectron;

        const getExtFromUrl = (url: string, contentType?: string): string => {
            if (contentType) {
                if (contentType.includes('png')) return 'png';
                if (contentType.includes('webp')) return 'webp';
                if (contentType.includes('gif')) return 'gif';
                if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
            }
            const match = url.match(/\.(png|webp|gif|jpeg|jpg)($|\?)/i);
            if (match) return match[1].toLowerCase();
            return 'jpg';
        };

        const fetchViaLocalProxy = async (url: string): Promise<{ blob: Blob; ext: string }> => {
            const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;
            const response = await window.fetch(proxyUrl);
            if (!response.ok) throw new Error(`Proxy: ${response.status}`);
            const blob = await response.blob();
            const ext = getExtFromUrl(url, response.headers.get('content-type') || '');
            return { blob, ext };
        };

        const fetchDirect = async (url: string): Promise<{ blob: Blob; ext: string }> => {
            const response = await window.fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const ext = getExtFromUrl(url, response.headers.get('content-type') || '');
            return { blob, ext };
        };

        const downloadOne = async (img: typeof allImages[0]) => {
            try {
                let result: { blob: Blob; ext: string };
                if (inElectron) {
                    result = await fetchDirect(img.url);
                } else {
                    result = await fetchViaLocalProxy(img.url);
                }

                const folder = img.group || '';
                const counterKey = folder || '__root__';
                groupCounters[counterKey] = (groupCounters[counterKey] || 0) + 1;
                const filename = `${String(groupCounters[counterKey]).padStart(4, '0')}.${result.ext}`;
                const path = folder ? `${folder}/${filename}` : filename;

                zip.file(path, result.blob);
                completed++;
                setDownloadProgress({ current: completed, total, status: `下载中 ${completed}/${total}` });
            } catch (err) {
                console.warn(`下载失败: ${img.url}`, err);
                failed++;
                completed++;
                setDownloadProgress({ current: completed, total, status: `下载中 ${completed}/${total} (${failed} 失败)` });
            }
        };

        for (let i = 0; i < allImages.length; i += concurrency) {
            const batch = allImages.slice(i, i + concurrency);
            await Promise.all(batch.map(downloadOne));
        }

        setDownloadProgress({ current: total, total, status: '正在打包 ZIP...' });

        try {
            const content = await zip.generateAsync({ type: 'blob' });
            const zipName = `缩略图_${new Date().toISOString().slice(0, 10)}_${allImages.length}张.zip`;
            saveAs(content, zipName);
            setDownloadProgress(null);
            setDownloadFeedback(`✅ 已下载 ${allImages.length - failed} 张图片${failed > 0 ? `（${failed} 张失败）` : ''}`);
            setTimeout(() => setDownloadFeedback(null), 3000);
        } catch (err) {
            console.error('ZIP 生成失败:', err);
            setDownloadProgress(null);
            setDownloadFeedback('❌ ZIP 打包失败，请重试');
            setTimeout(() => setDownloadFeedback(null), 3000);
        }
    }, []);

    return { downloadAllThumbnails, downloadProgress, downloadFeedback };
}
