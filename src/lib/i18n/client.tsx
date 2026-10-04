"use client";

import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { dictionaries, type Dictionary, type Locale } from "./dictionaries";

const I18nContext = createContext<{ locale: Locale; t: Dictionary }>({ locale: "en", t: dictionaries.en });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, t: dictionaries[locale] }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useSetLocale() {
  const router = useRouter();
  return (locale: Locale) => {
    document.cookie = `mos_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    router.refresh();
  };
}
