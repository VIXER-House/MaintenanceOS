import type { Metadata } from "next";
import "./globals.css";
import { getDictionary } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "MaintenanceOS",
  description: "WhatsApp-first AI maintenance management for compounds.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir } = await getDictionary();
  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <I18nProvider locale={locale}>
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
