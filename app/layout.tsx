import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppLayout } from "@/components/AppLayout";
import { FinanceProvider } from "@/components/providers/FinanceProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
