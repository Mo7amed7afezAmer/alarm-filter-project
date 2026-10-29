import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getServerSession } from "next-auth";
import { normalizeUiPrefs, type UiPrefs } from "@alarm/core";
import { PwaRegister } from "@/components/pwa";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Alarm Filter",
  description: "Mobile network alarm monitor",
  // installable web app: app/manifest.ts, public/sw.js, components/pwa.tsx
  applicationName: "Alarm Filter",
  appleWebApp: { capable: true, title: "Alarms", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1b2d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** The signed-in user's theme and borders (users.uiPrefs), rendered on <html> so the page never
 *  flashes. */
async function currentLook(): Promise<Pick<UiPrefs, "theme" | "borders">> {
  try {
    const session = await getServerSession(authOptions);
    const id = Number(session?.user?.id);
    const user = id
      ? await prisma.user.findUnique({ where: { id }, select: { uiPrefs: true } })
      : null;
    return normalizeUiPrefs(user?.uiPrefs);
  } catch {
    return normalizeUiPrefs(null);
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { theme, borders } = await currentLook();
  return (
    <html lang="en" data-theme={theme} data-borders={borders ? undefined : "off"}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
