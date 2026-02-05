/**
 * 图片压缩服务
 * 用于在导出前压缩图片减小文件大小
 */

export interface CompressOptions {
    maxWidth?: number;      // 最大宽度
    maxHeight?: number;     // 最大高度
    quality?: number;       // 质量 0-1
    format?: 'jpeg' | 'webp' | 'png';
}

const DEFAULT_OPTIONS: CompressOptions = {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.8,
    format: 'jpeg'
};

/**
 * 压缩 base64 图片
 * @param base64Data 原始 base64 数据（带或不带前缀）
 * @param options 压缩选项
 * @returns 压缩后的 base64 数据（带前缀）
 */
export const compressBase64Image = (
    base64Data: string,
    options: CompressOptions = {}
): Promise<string> => {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            try {
                // 计算新尺寸
                let { width, height } = img;
                const maxW = opts.maxWidth!;
                const maxH = opts.maxHeight!;

                if (width > maxW || height > maxH) {
                    const ratio = Math.min(maxW / width, maxH / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                // 创建 canvas 进行压缩
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                // 绘制图片
                ctx.drawImage(img, 0, 0, width, height);

                // 转换为压缩后的格式
                const mimeType = opts.format === 'png' ? 'image/png' :
                    opts.format === 'webp' ? 'image/webp' : 'image/jpeg';
                const compressed = canvas.toDataURL(mimeType, opts.quality);

                resolve(compressed);
            } catch (error) {
                reject(error);
            }
        };

        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };

        // 确保 base64 有正确的前缀
        if (base64Data.startsWith('data:')) {
            img.src = base64Data;
        } else {
            img.src = `data:image/png;base64,${base64Data}`;
        }
    });
};

/**
 * 批量压缩多张图片
 */
export const compressImages = async (
    base64List: string[],
    options: CompressOptions = {},
    onProgress?: (current: number, total: number) => void
): Promise<string[]> => {
    const results: string[] = [];

    for (let i = 0; i < base64List.length; i++) {
        try {
            const compressed = await compressBase64Image(base64List[i], options);
            results.push(compressed);
        } catch {
            // 压缩失败则使用原图
            results.push(base64List[i]);
        }
        onProgress?.(i + 1, base64List.length);
    }

    return results;
};

/**
 * 计算 base64 字符串的近似文件大小
 */
export const getBase64Size = (base64: string): number => {
    // 移除 data URL 前缀
    const base64Only = base64.replace(/^data:image\/\w+;base64,/, '');
    // base64 编码后大小约为原始大小的 4/3
    return Math.round((base64Only.length * 3) / 4);
};

/**
 * 格式化文件大小显示
 */
export const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};
