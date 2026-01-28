import {
  DEFAULT_PRESET_SUBMIT_URL,
  PresetSheetConfig,
  SheetPresetRow
} from './presetSheetService';

// Shared Google Sheet configuration used by all preset-sync features.
export const SHARED_PRESET_SHEET_CONFIG: PresetSheetConfig = {
  sheetId: '1InDrlrypvb_5xwtNCmqYIUuWL5cm7YNbBaCvJuEY9D0',
  sheetName: 'StudioPresets',
  submitUrl: DEFAULT_PRESET_SUBMIT_URL
};

const SCOPE_PREFIX = '__scope__::';

export type PresetScope = 'magic' | 'template' | 'imageRecognition';

export const PRESET_SCOPE_MAGIC: PresetScope = 'magic';
export const PRESET_SCOPE_TEMPLATE: PresetScope = 'template';
export const PRESET_SCOPE_IMAGE_RECOGNITION: PresetScope = 'imageRecognition';

type ScopedCategory = {
  scope: string;
  name: string;
};

const parseScopedCategory = (category: string | undefined | null): ScopedCategory | null => {
  if (!category || !category.startsWith(SCOPE_PREFIX)) {
    return null;
  }
  const remainder = category.slice(SCOPE_PREFIX.length);
  const separatorIndex = remainder.indexOf('::');
  if (separatorIndex === -1) {
    return null;
  }
  const scope = remainder.slice(0, separatorIndex).trim();
  const name = remainder.slice(separatorIndex + 2).trim();
  if (!scope) {
    return null;
  }
  return { scope, name };
};

export const encodeScopedCategory = (scope: PresetScope, name: string): string =>
  `${SCOPE_PREFIX}${scope}::${name}`;

/**
 * Strip the scope prefix if it matches the provided scope. Returns null otherwise.
 */
export const stripScopedCategory = (
  category: string,
  scope: PresetScope
): string | null => {
  const parsed = parseScopedCategory(category);
  if (!parsed || parsed.scope !== scope) {
    return null;
  }
  return parsed.name;
};

/**
 * Returns rows that belong to the provided scope and removes the scope prefix
 * from the returned category labels.
 */
export const extractScopedRows = (
  rows: SheetPresetRow[],
  scope: PresetScope
): SheetPresetRow[] => {
  return rows
    .map((row) => {
      const scopedName = stripScopedCategory(row.category, scope);
      if (!scopedName) {
        return null;
      }
      return { ...row, category: scopedName };
    })
    .filter((row): row is SheetPresetRow => !!row);
};
