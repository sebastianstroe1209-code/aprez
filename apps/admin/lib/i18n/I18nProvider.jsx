'use client'

// Tier C5 i18n scaffold (admin). Same client-side localStorage pattern as
// the restaurant platform — keeps the scaffold simple and avoids the
// app/[locale]/ route refactor. SPEC §11.

import { NextIntlClientProvider } from 'next-intl'
import { createContext, useContext, useEffect, useState } from 'react'
import roMessages from '../../locales/ro.json'
import enMessages from '../../locales/en.json'

const MESSAGES = { ro: roMessages, en: enMessages }
const SUPPORTED = ['ro', 'en']
const STORAGE_KEY = 'aprez.admin.locale'

const LocaleContext = createContext({
  locale: 'ro',
  setLocale: () => {},
})

export function useAppLocale() {
  return useContext(LocaleContext)
}

export default function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState('ro')

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored && SUPPORTED.includes(stored)) setLocaleState(stored)
    } catch (e) { /* ignore */ }
  }, [])

  const setLocale = (next) => {
    if (!SUPPORTED.includes(next)) return
    setLocaleState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch (e) { /* ignore */ }
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale]}
        timeZone="Europe/Bucharest"
      >
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  )
}
