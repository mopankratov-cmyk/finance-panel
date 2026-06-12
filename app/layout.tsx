import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppLayout } from "@/components/AppLayout";
import { FinanceProvider } from "@/components/providers/FinanceProvider";
import "./globals.css";

// Локальные шрифты geist (Vercel) — без обращения к Google Fonts на сборке.
const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "Финансы МП — Панель управления",
  description: "Управление денежными потоками для продавцов маркетплейсов",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <FinanceProvider>
          <AppLayout>{children}</AppLayout>
        </FinanceProvider>
      </body>
    </html>
  );
}
