export interface PresetSheetConfig {
  sheetId: string;
  sheetName?: string;
  submitUrl?: string;
}

export interface SheetPresetRow {
  user: string;
  category: string;
  presetLabel: string;
  prompt: string;
  categoryOrder?: number;
  presetOrder?: number;
}

const DEFAULT_SHEET_NAME = 'StudioPresets';
const PRESET_SUBMIT_FALLBACK = 'https://script.google.com/macros/s/AKfycbw9isNUlIuSST9DxOV-d8hfpfp85_fMJnRLJJRBcNPVMvw5ut83ShNGS-S8Fht99nKvsg/exec';
const envPresetUrl =
  typeof process !== 'undefined' && process.env
    ? process.env.PRESET_SUBMIT_URL ||
      (process.env as Record<string, string | undefined>).VITE_PRESET_SUBMIT_URL ||
      ''
    : '';

export const DEFAULT_PRESET_SUBMIT_URL = envPresetUrl || PRESET_SUBMIT_FALLBACK;

const getSafeString = (value: any): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export type SheetPresetSaveRow = Omit<SheetPresetRow, 'user'>;

export interface SavePresetRowsParams {
  userName: string;
  rows: SheetPresetSaveRow[];
  config: PresetSheetConfig;
  ensureHeaderRow?: boolean;
}

/**
 * Read presets for a single user from a public Google Sheet tab using GViz.
 */
export async function fetchUserPresetsFromSheet(
  userName: string,
  config: PresetSheetConfig
): Promise<SheetPresetRow[]> {
  const normalizedUser = getSafeString(userName).toLowerCase();
  if (!normalizedUser) return [];
  if (!config.sheetId) throw new Error('未配置预设的表格 ID');

  const sheetName = encodeURIComponent(config.sheetName || DEFAULT_SHEET_NAME);
  const escapedUser = normalizedUser.replace(/'/g, "''");
  const query = encodeURIComponent(`select * where lower(A)='${escapedUser}'`);
  const url = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tq=${query}&sheet=${sheetName}&tqx=out:json&_=${Date.now()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取表格失败: ${response.statusText}`);
  }

  const text = await response.text();
  const jsonString = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const json = JSON.parse(jsonString);

  if (json.status === 'error') {
    const message = (json.errors?.[0]?.message || '表格返回错误').trim();
    if (message.toUpperCase() === 'INVALID_QUERY') {
      console.warn(
        'Google Sheet query returned INVALID_QUERY. Check sheet name/header configuration.',
        { sheetId: config.sheetId, sheetName: config.sheetName || DEFAULT_SHEET_NAME, user: normalizedUser }
      );
      return [];
    }
    throw new Error(message);
  }

  const rows = (json.table.rows || []) as any[];
  return rows
    .map((r) => {
      const cells = r.c || [];
      const categoryOrder = Number(cells[4]?.v);
      const presetOrder = Number(cells[5]?.v);

      return {
        user: getSafeString(cells[0]?.v),
        category: getSafeString(cells[1]?.v),
        presetLabel: getSafeString(cells[2]?.v),
        prompt: getSafeString(cells[3]?.v),
        categoryOrder: Number.isFinite(categoryOrder) ? categoryOrder : undefined,
        presetOrder: Number.isFinite(presetOrder) ? presetOrder : undefined
      } as SheetPresetRow;
    })
    .filter((row) => row.presetLabel && row.prompt);
}

export async function savePresetRowsToSheet({
  userName,
  rows,
  config,
  ensureHeaderRow = false
}: SavePresetRowsParams): Promise<void> {
  const normalizedUser = getSafeString(userName).toLowerCase();
  if (!normalizedUser) {
    throw new Error('未提供有效的表格用户名');
  }
  if (!config.sheetId) {
    throw new Error('未配置预设的表格 ID');
  }
  const submitUrl = config.submitUrl || DEFAULT_PRESET_SUBMIT_URL;
  if (!submitUrl) {
    throw new Error('未配置预设保存接口 URL');
  }
  if (!rows.length) {
    throw new Error('没有可保存的预设数据');
  }

  const payload = {
    action: 'savePresets',
    sheetId: config.sheetId,
    sheetName: config.sheetName || DEFAULT_SHEET_NAME,
    ensureHeaderRow,
    rows: rows.map((row) => ({
      user: normalizedUser,
      category: row.category,
      presetLabel: row.presetLabel,
      prompt: row.prompt,
      categoryOrder: row.categoryOrder,
      presetOrder: row.presetOrder
    }))
  };

  try {
    await fetch(submitUrl, {
      method: 'POST',
      mode: 'no-cors',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Failed to save presets to sheet:', error);
    throw new Error('保存预设失败，请稍后重试。');
  }
}
