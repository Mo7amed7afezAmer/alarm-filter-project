import type { Metadata } from "next";
import localFont from "next/font/local";
import { getServerSession } from "next-auth";
import { normalizeUiPrefs, type Theme } from "@alarm/core";
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
};

/** The signed-in user's theme (users.uiPrefs), rendered on <html> so the page never flashes. */
async function currentTheme(): Promise<Theme> {
  try {
    const session = await getServerSession(authOptions);
    const id = Number(session?.user?.id);
    if (!id) return normalizeUiPrefs(null).theme;
    const user = await prisma.user.findUnique({ where: { id }, select: { uiPrefs: true } });
    return normalizeUiPrefs(user?.uiPrefs).theme;
  } catch {
    return normalizeUiPrefs(null).theme;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = await currentTheme();
  return (
    <html lang="en" data-theme={theme}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
