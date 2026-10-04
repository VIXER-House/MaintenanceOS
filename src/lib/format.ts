/** Locale-aware formatting helpers (Cairo time zone). Pure — safe on server and client. */
const TZ = "Africa/Cairo";
type Loc = "en" | "ar";
const intl = (l: Loc) => (l === "ar" ? "ar-EG" : "en-GB");

export function formatMoney(n: number | null | undefined, locale: Loc = "en", withCurrency = true) {
  if (n === null || n === undefined) return "—";
  const s = new Intl.NumberFormat(intl(locale), { maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  return withCurrency ? `${s} ${locale === "ar" ? "ج.م" : "EGP"}` : s;
}

export function formatNumber(n: number, locale: Loc = "en") {
  return new Intl.NumberFormat(intl(locale)).format(n);
}

export function formatDateTime(iso: string | Date | null | undefined, locale: Loc = "en") {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(intl(locale), { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string | Date | null | undefined, locale: Loc = "en") {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(intl(locale), { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
}

export function formatTime(iso: string | Date, locale: Loc = "en") {
  return new Date(iso).toLocaleTimeString(intl(locale), { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

/** "2h 05m" style; localized unit suffixes */
export function formatMinutes(min: number | null | undefined, locale: Loc = "en") {
  if (min === null || min === undefined || !isFinite(min)) return "—";
  const u = locale === "ar" ? { d: "ي", h: "س", m: "د" } : { d: "d", h: "h", m: "m" };
  const neg = min < 0;
  let m = Math.round(Math.abs(min));
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  const s = d > 0 ? `${d}${u.d} ${h}${u.h}` : h > 0 ? `${h}${u.h} ${String(m).padStart(2, "0")}${u.m}` : `${m}${u.m}`;
  return neg ? `-${s}` : s;
}

export function relativeTime(iso: string | Date, locale: Loc = "en") {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(intl(locale), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}
