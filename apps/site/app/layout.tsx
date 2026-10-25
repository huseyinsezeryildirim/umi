import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Umi — the free screen recorder",
  description:
    "Record your screen, camera and voice. Smooth zooms, captions, clean sound and AI that runs on your computer. Free and open source for Mac, Windows, Linux and Chrome.",
  icons: { icon: "/umi-mark.svg" },
  openGraph: {
    title: "Umi — the free screen recorder",
    description: "Beautiful screen recordings, free forever. Mac, Windows, Linux and Chrome.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#f3f8fe", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
