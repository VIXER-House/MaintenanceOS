import type { Priority, TicketStatus } from "./constants";

type L = { en: string; ar: string };

export const PRIORITY_LABELS: Record<Priority, L> = {
  EMERGENCY: { en: "Emergency", ar: "طارئ" },
  CRITICAL: { en: "Critical", ar: "حرج" },
  HIGH: { en: "High", ar: "عالي" },
  MEDIUM: { en: "Medium", ar: "متوسط" },
  LOW: { en: "Low", ar: "منخفض" },
};

export const STATUS_LABELS: Record<TicketStatus, L> = {
  NEW: { en: "New", ar: "جديد" },
  AI_ANALYZING: { en: "AI analyzing", ar: "قيد التحليل" },
  WAITING_FOR_INFO: { en: "Waiting for info", ar: "في انتظار معلومات" },
  ASSIGNED: { en: "Assigned", ar: "تم التعيين" },
  ACKNOWLEDGED: { en: "Acknowledged", ar: "تم الاستلام" },
  IN_PROGRESS: { en: "In progress", ar: "جاري التنفيذ" },
  WAITING_QUOTATION: { en: "Waiting quotation", ar: "في انتظار عرض السعر" },
  WAITING_APPROVAL: { en: "Waiting approval", ar: "في انتظار الموافقة" },
  APPROVED: { en: "Approved", ar: "تمت الموافقة" },
  REJECTED: { en: "Rejected", ar: "مرفوض" },
  COMPLETED: { en: "Completed", ar: "تم التنفيذ" },
  CLOSED: { en: "Closed", ar: "مغلق" },
  CANCELLED: { en: "Cancelled", ar: "ملغي" },
};

export function formatMinutesHuman(min: number, lang: "ar" | "en"): string {
  if (min < 60) return lang === "ar" ? `${min} دقيقة` : `${min} minutes`;
  const h = Math.round((min / 60) * 10) / 10;
  if (h < 48) {
    if (lang === "ar") return h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${h} ساعات`;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  const d = Math.round(h / 24);
  if (lang === "ar") return d === 2 ? "يومين" : `${d} أيام`;
  return `${d} days`;
}
