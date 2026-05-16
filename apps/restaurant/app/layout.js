import { Inter } from 'next/font/google'
import './globals.css'
import I18nProvider from '../lib/i18n/I18nProvider'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'ApRez Restaurant',
  description: 'Restaurant management platform',
}

export default function RootLayout({ children }) {
  // SPEC §11: Romanian primary. The <html lang> tag stays "ro" by default;
  // I18nProvider may swap the message bundle client-side but the document
  // lang attribute is only authoritative at SSR.
  return (
    <html lang="ro">
      <body className={inter.className}>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
