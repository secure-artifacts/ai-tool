const STORAGE_KEY = 'app_preset_skip_save_confirm';

export const getShouldSkipPresetSaveConfirm = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const setShouldSkipPresetSaveConfirm = (skip: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    if (skip) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
};
