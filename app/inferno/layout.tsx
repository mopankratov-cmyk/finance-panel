import type { ReactNode } from "react";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--pc-font-sans",
  weight: ["400", "500", "600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--pc-font-mono",
  weight: ["400", "500", "700"],
});

export default function InfernoLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      {children}
    </div>
  );
}
