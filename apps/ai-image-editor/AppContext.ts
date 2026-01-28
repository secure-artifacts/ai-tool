
import React from 'react';
import { TranslationKey } from './i18n';

export interface AppContextType {
  language: 'zh' | 'en';
  setLanguage: (lang: 'zh' | 'en') => void;
  theme: 'dark' | 'light' | 'green';
  setTheme: (theme: 'dark' | 'light' | 'green') => void;
  t: (key: TranslationKey, options?: Record<string, string>) => string;
}

export const AppContext = React.createContext<AppContextType>({
  language: 'zh',
  setLanguage: () => {},
  theme: 'dark',
  setTheme: () => {},
  t: (key: TranslationKey) => key,
});