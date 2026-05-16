'use client'

// Tier C5 i18n scaffold. Client-side locale selection via localStorage
// (per SPEC §11 + memory/waiter_ux_strategy.md §4.6). URL-based routing
// (/ro/* and /en/*) is intentionally deferred — it would require moving
// every route under app/[locale]/ which is out of scope for the scaffold.
// Default locale 'ro' so the first paint matches the SPEC-mandated default
// for Romanian users.

import { NextIntlClientProvider } from 'next-intl'
import { createContext, useContext, useEffect, useState } from 'react'
import roMessages from '../../locales/ro.json'
import enMessages from '../../locales/en.json'

const MESSAGES = { ro: roMessages, en: enMessages }
const SUPPORTED = ['ro', 'en']
const STORAGE_KEY = 'aprez.locale'

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
