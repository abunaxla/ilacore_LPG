import type { Metadata, Viewport } from 'next';
import { getMessages } from '@/i18n';
import './globals.css';

const t = getMessages();

export const metadata: Metadata = {
  title: t.app.name,
  description: t.app.tagline,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never block zooming: people must be able to enlarge text (WCAG 1.4.4).
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <a href="#main" className="skip-link">
          {t.app.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
