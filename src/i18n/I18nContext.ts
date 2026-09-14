import { createContext } from 'react'
import type { Language, TranslationKey } from './translations'

export type I18nContextValue = {
  language: Language
  t: (key: TranslationKey) => string
  setLanguage: (language: Language) => Promise<void>
}

export const I18nContext = createContext<I18nContextValue | null>(null)
