import type { ReactNode } from 'react';

import { clashDisplay, generalSans } from '../src/lib/fonts';
import '../src/styles/globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${clashDisplay.variable} ${generalSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
