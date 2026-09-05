import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppLayout } from "@/components/AppLayout";
import { FinanceProvider } from "@/components/providers/FinanceProvider";
import { KeyboardInset } from "@/components/ui/KeyboardInset";
import "./globals.css";

// Локальные шрифты geist (Vercel) — без обращения к Google Fonts на сборке.
const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "Финансы МП — Панель управления",
  description: "Управление денежными потоками для продавцов маркетплейсов",
};

/**
 * Вьюпорт: панелью работают с телефона и с iPad, а не только с компьютера.
 *
 * `viewportFit: "cover"` — единственный способ получить от браузера значения
 * `env(safe-area-inset-*)`. Без него они равны нулю, и закреплённые панели
 * уезжают под вырез сверху и под системный индикатор снизу — на iPhone это
 * выглядит как обрезанная кнопка, а не как ошибка вёрстки.
 *
 * `maximumScale` и `userScalable` НЕ задаём осознанно: запрет масштабирования
 * страницы пальцами отбирает у человека последний способ прочитать мелкое.
 * Вместо запрета — размеры, при которых увеличивать не нужно.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1a1a2e",
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
        <KeyboardInset />
        <FinanceProvider>
          <AppLayout>{children}</AppLayout>
        </FinanceProvider>
      </body>
    </html>
  );
}
