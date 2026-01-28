// Electron 本地缓存 API 类型定义
interface ElectronCacheAPI {
    // 保存数据到本地文件（支持 GB 级别数据）
    save: (key: string, data: unknown) => Promise<{ success: boolean; error?: string }>;

    // 读取本地缓存
    load: (key: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;

    // 删除缓存
    delete: (key: string) => Promise<{ success: boolean; error?: string }>;

    // 列出所有缓存
    list: () => Promise<{
        success: boolean;
        files?: Array<{
            key: string;
            size: number;
            modifiedAt: string;
        }>;
        error?: string;
    }>;

    // 获取缓存统计
    stats: () => Promise<{
        success: boolean;
        totalSize?: number;
        totalSizeMB?: string;
        path?: string;
        error?: string;
    }>;

    // 是否在 Electron 环境
    isElectron: boolean;
}

interface ElectronInfo {
    platform: 'darwin' | 'win32' | 'linux';
    version: string;
    isElectron: boolean;
}

declare global {
    interface Window {
        electronCache?: ElectronCacheAPI;
        electronInfo?: ElectronInfo;
    }
}

export { };
