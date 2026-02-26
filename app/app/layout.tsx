import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav          from "./components/Nav";
import GlobalSearch from "./components/GlobalSearch";
import LeftSidebar  from "./components/LeftSidebar";
import dynamic      from "next/dynamic";

const TickerTape = dynamic(() => import("./components/TickerTape"), { ssr: false });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title:       "Giełda Monitor",
  description: "Professional stock monitoring for GPW & USA markets",
  manifest:    "/manifest.json",
  appleWebApp: {
    capable:         true,
    statusBarStyle:  "black-translucent",
    title:           "Giełda Monitor",
  },
};

export const viewport: Viewport = {
  width:        "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor:   "#111827",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950`}
      >
        {/* Top bar: ticker tape + nav */}
        <div className="sticky top-0 z-40">
          <TickerTape />
          <Nav />
        </div>

        {/* Body: left sidebar + main content */}
        <div className="flex">
          <LeftSidebar />
          <main className="flex-1 min-w-0">
            <GlobalSearch />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
