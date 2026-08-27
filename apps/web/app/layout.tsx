import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ControlShift',
  description: 'Industrial Migration Preflight',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <h1>ControlShift</h1>
          <span className="tag">Industrial Migration Preflight</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
