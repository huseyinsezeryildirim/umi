import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";
import { API } from "@/lib/account";
import "./globals.css";

export const metadata: Metadata = {
  title: "Umi — the free screen recorder",
  description:
    "Record your screen, camera and voice. Smooth zooms, captions, clean sound and AI that runs on your computer. Free and open source for Mac, Windows, Linux and the browser.",
  icons: { icon: "/umi-mark.svg" },
  // Only the live site is indexed: staging and previews (which sell with Paddle's test cards) stay out of search.
  robots: API === "https://umi.cam" ? undefined : { index: false, follow: false },
  openGraph: {
    title: "Umi — the free screen recorder",
    description: "Beautiful screen recordings, free forever. Mac, Windows, Linux and the browser.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Extensions (e.g. ColorZilla) add attributes to <body> before React loads. */}
      <body className="font-sans" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
