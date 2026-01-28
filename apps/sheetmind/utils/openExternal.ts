/**
 * 在外部浏览器中打开链接
 * - Electron 环境下优先使用 Chrome
 * - 普通浏览器环境使用 window.open
 */
export function openExternalUrl(url: string): void {
    // 检查是否在 Electron 环境
    const electronAPI = (window as any).electronAPI;

    if (electronAPI?.openExternal) {
        // Electron 环境：通过 IPC 用 Chrome 打开
        electronAPI.openExternal(url);
    } else {
        // 普通浏览器：使用 window.open
        window.open(url, '_blank');
    }
}

/**
 * 检查是否在 Electron 环境中
 */
export function isElectron(): boolean {
    return !!(window as any).electronAPI?.isElectron;
}
