import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CS2 Portfolio Tracker',
  description: 'Track the value, cost basis, and P/L of your CS2 skin inventory',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
