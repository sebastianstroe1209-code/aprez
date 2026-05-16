import { Inter } from 'next/font/google'
import './globals.css'
import I18nProvider from '../lib/i18n/I18nProvider'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'ApRez Admin',
  description: 'Restaurant management admin panel',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ro">
      <body className={inter.className}>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
