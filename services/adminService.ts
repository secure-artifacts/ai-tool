// 管理员权限校验服务

interface FetchAdminsOptions {
    googleSheetId: string;
    sheetName?: string;
}

/**
 * 从 Google Sheets 获取管理员列表
 */
export async function fetchAdmins(options: FetchAdminsOptions): Promise<string[]> {
    const { googleSheetId, sheetName = 'admins' } = options;

    try {
        // 使用 Google Sheets API 公开访问格式
        const url = `https://docs.google.com/spreadsheets/d/${googleSheetId}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;
        const response = await fetch(url);

        if (!response.ok) {
            console.warn('[AdminService] 获取管理员列表失败:', response.status);
            return [];
        }

        const text = await response.text();

        // 解析 CSV，提取邮箱（假设第一列是邮箱）
        const lines = text.split('\n').filter(line => line.trim());
        const emails: string[] = [];

        for (const line of lines) {
            // 移除引号并提取第一列
            const match = line.match(/^"?([^",]+)"?/);
            if (match && match[1]) {
                const email = match[1].trim().toLowerCase();
                // 简单验证邮箱格式
                if (email.includes('@') && !email.startsWith('email')) {
                    emails.push(email);
                }
            }
        }

        return emails;
    } catch (error) {
        console.error('[AdminService] 获取管理员列表异常:', error);
        return [];
    }
}

export const adminService = {
    fetchAdmins,
};
