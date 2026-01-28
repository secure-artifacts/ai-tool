/**
 * Image Compression Service - 图片压缩服务
 * 用于压缩大图片，使其可以保存到 Firebase
 */

// ============= 配置 =============

export interface CompressionOptions {
    maxWidth: number;
    maxHeight: number;
    quality: number;        // 0-1
    thumbnailSize: number;  // 缩略图尺寸
}

const DEFAULT_OPTIONS: CompressionOptions = {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.8,
    thumbnailSize: 200
};

// ============= 类型 =============

export interface CompressedImage {
    dataUrl: string;       // 压缩后的 data URL
    width: number;
    height: number;
    originalSize: number;  // 原始大小 (bytes)
    compressedSize: number; // 压缩后大小 (bytes)
}

export interface ImageThumbnail {
    dataUrl: string;
    width: number;
    height: number;
}

// ============= 核心函数 =============

/**
 * 压缩图片
 * @param source 图片源 (URL, Blob, File, 或 base64)
 * @param options 压缩选项
 */
export const compressImage = async (
    source: string | Blob | File,
    options: Partial<CompressionOptions> = {}
): Promise<CompressedImage> => {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // 加载图片
    const img = await loadImage(source);

    // 计算压缩后尺寸
    const { width, height } = calculateDimensions(
        img.width,
        img.height,
        opts.maxWidth,
        opts.maxHeight
    );

    // 创建 canvas 并绘制
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);

    // 转换为 JPEG
    const dataUrl = canvas.toDataURL('image/jpeg', opts.quality);

    // 计算大小
    const originalSize = await getImageSize(source);
    const compressedSize = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);

    return {
        dataUrl,
        width,
        height,
        originalSize,
        compressedSize
    };
};

/**
 * 生成缩略图
 */
export const generateThumbnail = async (
    source: string | Blob | File,
    size: number = DEFAULT_OPTIONS.thumbnailSize
): Promise<ImageThumbnail> => {
    const img = await loadImage(source);

    // 计算缩略图尺寸 (保持比例，短边为 size)
    let width: number, height: number;
    if (img.width > img.height) {
        height = size;
        width = Math.round(img.width * (size / img.height));
    } else {
        width = size;
        height = Math.round(img.height * (size / img.width));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);

    return {
        dataUrl: canvas.toDataURL('image/jpeg', 0.7),
        width,
        height
    };
};

/**
 * 批量压缩图片
 */
export const compressImages = async (
    sources: (string | Blob | File)[],
    options: Partial<CompressionOptions> = {},
    onProgress?: (completed: number, total: number) => void
): Promise<CompressedImage[]> => {
    const results: CompressedImage[] = [];

    for (let i = 0; i < sources.length; i++) {
        try {
            const compressed = await compressImage(sources[i], options);
            results.push(compressed);
        } catch (error) {
            console.error(`[ImageCompression] Failed to compress image ${i}:`, error);
            // 返回占位符
            results.push({
                dataUrl: '',
                width: 0,
                height: 0,
                originalSize: 0,
                compressedSize: 0
            });
        }

        onProgress?.(i + 1, sources.length);
    }

    return results;
};

/**
 * 判断是否需要压缩
 * @param source 图片源
 * @param maxSizeBytes 最大文件大小 (默认 500KB)
 */
export const needsCompression = async (
    source: string | Blob | File,
    maxSizeBytes: number = 500 * 1024
): Promise<boolean> => {
    const size = await getImageSize(source);
    return size > maxSizeBytes;
};

/**
 * 智能压缩 - 只在需要时压缩
 */
export const smartCompress = async (
    source: string | Blob | File,
    options: Partial<CompressionOptions> = {},
    maxSizeBytes: number = 500 * 1024
): Promise<string> => {
    // 如果是云端 URL，直接返回
    if (typeof source === 'string' && isCloudUrl(source)) {
        return source;
    }

    // 检查是否需要压缩
    const needs = await needsCompression(source, maxSizeBytes);
    if (!needs && typeof source === 'string') {
        return source;
    }

    // 压缩
    const compressed = await compressImage(source, options);
    console.log(`[ImageCompression] Compressed: ${formatBytes(compressed.originalSize)} → ${formatBytes(compressed.compressedSize)}`);

    return compressed.dataUrl;
};

// ============= 辅助函数 =============

/**
 * 加载图片
 */
const loadImage = (source: string | Blob | File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));

        if (typeof source === 'string') {
            img.src = source;
        } else {
            img.src = URL.createObjectURL(source);
        }
    });
};

/**
 * 计算压缩后的尺寸
 */
const calculateDimensions = (
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
): { width: number; height: number } => {
    let width = originalWidth;
    let height = originalHeight;

    // 如果已经小于限制，保持原尺寸
    if (width <= maxWidth && height <= maxHeight) {
        return { width, height };
    }

    // 按比例缩小
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);

    return { width, height };
};

/**
 * 获取图片大小
 */
const getImageSize = async (source: string | Blob | File): Promise<number> => {
    // 使用类型守卫而不是 instanceof 来避免 TypeScript 错误
    if (typeof source === 'object' && source !== null && 'size' in source) {
        return (source as Blob).size;
    }

    if (typeof source === 'string') {
        // Data URL
        if (source.startsWith('data:')) {
            const base64 = source.split(',')[1];
            return Math.round(base64.length * 0.75);
        }

        // 远程 URL - 尝试获取大小
        try {
            const response = await fetch(source, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                return parseInt(contentLength, 10);
            }
        } catch {
            // 忽略错误
        }
    }

    return 0;
};

/**
 * 判断是否为云端 URL
 */
const isCloudUrl = (url: string): boolean => {
    const cloudPatterns = [
        'gyazo.com',
        'i.gyazo.com',
        'drive.google.com',
        'lh3.googleusercontent.com',
        'images.weserv.nl',
        'imgur.com',
        'cloudinary.com'
    ];

    return cloudPatterns.some(pattern => url.includes(pattern));
};

/**
 * 格式化字节数
 */
const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/**
 * 从状态对象中提取并压缩所有图片
 * 用于保存工作区状态前的预处理
 */
export const compressStateImages = async (
    state: any,
    options: Partial<CompressionOptions> = {}
): Promise<any> => {
    if (!state || typeof state !== 'object') {
        return state;
    }

    // 递归处理对象
    const processValue = async (value: any): Promise<any> => {
        if (typeof value === 'string') {
            // 检查是否是图片 URL 或 base64
            if (value.startsWith('data:image/') ||
                (value.startsWith('blob:') && value.length < 100)) {
                try {
                    return await smartCompress(value, options);
                } catch {
                    return value;
                }
            }
            return value;
        }

        if (Array.isArray(value)) {
            return Promise.all(value.map(processValue));
        }

        if (value && typeof value === 'object') {
            const result: any = {};
            for (const key of Object.keys(value)) {
                result[key] = await processValue(value[key]);
            }
            return result;
        }

        return value;
    };

    return processValue(state);
};
