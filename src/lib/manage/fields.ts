/**
 * Form definitions for every manageable record. Built on the server page (labels in the
 * user's language + options from the database) and rendered by the generic dialog.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { FieldDef } from "@/features/manage/entity-ui";
import { PRIORITY_LABELS } from "@/server/domain/labels";
import { PRIORITIES } from "@/server/domain/constants";

type Opt = { value: string; label: string };
type Locale = "en" | "ar";

export function residentFields(t: Dictionary): FieldDef[] {
  const f = t.manage.f;
  return [
    { name: "name", label: f.name, type: "text", required: true },
    { name: "nameAr", label: f.nameAr, type: "text", dir: "rtl" },
    { name: "phone", label: f.phone, type: "phone", required: true, placeholder: "01XXXXXXXXX" },
    { name: "unit", label: f.unit, type: "lookup", lookup: "units", required: true, placeholder: "A01-101" },
    { name: "isOwner", label: f.relation, type: "select", required: true, options: [{ value: "true", label: f.owner }, { value: "false", label: f.tenant }] },
    { name: "language", label: f.language, type: "select", required: true, options: [{ value: "ar", label: "العربية" }, { value: "en", label: "English" }] },
    { name: "email", label: f.email, type: "email" },
    { name: "verified", label: f.verified, type: "checkbox" },
  ];
}

export function buildingFields(t: Dictionary): FieldDef[] {
  const f = t.manage.f;
  return [
    { name: "code", label: f.code, type: "text", required: true, dir: "ltr", placeholder: "A01" },
    { name: "name", label: f.name, type: "text" },
    { name: "floors", label: f.floors, type: "number" },
  ];
}

export function unitFields(t: Dictionary): FieldDef[] {
  const f = t.manage.f;
  return [
    { name: "code", label: f.code, type: "text", required: true, dir: "ltr", placeholder: "A01-101" },
    { name: "building", label: f.building, type: "lookup", lookup: "buildings", required: true, placeholder: "A01" },
    { name: "floor", label: f.floor, type: "number" },
    { name: "type", label: f.unitType, type: "text", placeholder: "Apartment / Villa / Duplex" },
    { name: "areaSqm", label: f.area, type: "number" },
  ];
}

export function technicianFields(t: Dictionary, skills: Opt[], teams: Opt[]): FieldDef[] {
  const f = t.manage.f;
  return [
    { name: "name", label: f.name, type: "text", required: true },
    { name: "nameAr", label: f.nameAr, type: "text", dir: "rtl" },
    { name: "phone", label: f.phone, type: "phone", required: true, placeholder: "01XXXXXXXXX" },
    { name: "email", label: f.loginEmail, type: "email" },
    { name: "skills", label: f.skills, type: "multiselect", required: true, options: [...skills, { value: "GENERAL", label: f.general }] },
    { name: "teamId", label: f.team, type: "select", options: teams },
    { name: "maxConcurrent", label: f.maxJobs, type: "number" },
    {
      name: "status",
      label: f.status,
      type: "select",
      required: true,
      options: (["AVAILABLE", "BUSY", "OFF_DUTY"] as const).map((s) => ({ value: s, label: t.technicians[s] })),
    },
  ];
}

export function contractorFields(t: Dictionary, categories: Opt[]): FieldDef[] {
  const f = t.manage.f;
  return [
    { name: "name", label: f.name, type: "text", required: true },
    { name: "nameAr", label: f.nameAr, type: "text", dir: "rtl" },
    { name: "category", label: f.category, type: "select", required: true, options: categories },
    { name: "phone", label: f.phone, type: "phone", required: true },
    { name: "email", label: f.email, type: "email" },
    { name: "rating", label: f.rating, type: "number" },
    { name: "isActive", label: f.isActive, type: "checkbox" },
  ];
}

export function assetFields(t: Dictionary, categories: Opt[]): FieldDef[] {
  const f = t.manage.f;
  const statuses = ["OPERATIONAL", "NEEDS_ATTENTION", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "RETIRED"];
  return [
    { name: "assetCode", label: f.assetCode, type: "text", required: true, dir: "ltr", placeholder: "ELV-A01-1" },
    { name: "type", label: f.type, type: "text", required: true, placeholder: "Elevator / Water pump / Split AC" },
    { name: "name", label: f.name, type: "text", required: true },
    { name: "nameAr", label: f.nameAr, type: "text", dir: "rtl" },
    { name: "category", label: f.category, type: "select", options: categories },
    { name: "status", label: f.status, type: "select", required: true, options: statuses.map((s) => ({ value: s, label: (t.assets as Record<string, string>)[s] ?? s })) },
    { name: "building", label: f.building, type: "lookup", lookup: "buildings" },
    { name: "unit", label: f.unit, type: "lookup", lookup: "units" },
    { name: "location", label: f.location, type: "text", wide: true },
    { name: "installationDate", label: f.installed, type: "date" },
    { name: "warrantyExpiry", label: f.warranty, type: "date" },
    { name: "manufacturer", label: f.manufacturer, type: "text" },
    { name: "model", label: f.model, type: "text" },
    { name: "serialNumber", label: f.serial, type: "text", dir: "ltr" },
  ];
}

export function categoryFields(t: Dictionary, locale: Locale): FieldDef[] {
  const f = t.manage.f;
  return [
    { name: "nameEn", label: f.nameEn, type: "text", required: true, dir: "ltr" },
    { name: "nameAr", label: f.nameAr, type: "text", required: true, dir: "rtl" },
    { name: "key", label: f.key, type: "text", dir: "ltr", createOnly: true, placeholder: "POOL" },
    { name: "defaultPriority", label: f.defaultPriority, type: "select", required: true, options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p][locale] })) },
    { name: "description", label: f.description, type: "textarea", hint: locale === "ar" ? "الذكاء الاصطناعي بيستخدم الوصف ده عشان يعرف إمتى يختار التصنيف." : "The AI uses this description to decide when to pick this category." },
    { name: "keywords", label: f.keywords, type: "tags", hint: locale === "ar" ? "كلمات السكان بيكتبوها عن المشكلة دي (مثال: البيسين، حمام السباحة، pool)" : "Words residents use for this kind of problem (e.g. البيسين، حمام السباحة، pool)" },
    { name: "defaultResolutionMinutes", label: f.defaultResolution, type: "number" },
    { name: "quotationThreshold", label: f.threshold, type: "number" },
  ];
}

export function teamFields(t: Dictionary, categories: Opt[]): FieldDef[] {
  const f = t.manage.f;
  return [
    { name: "name", label: f.name, type: "text", required: true },
    { name: "nameAr", label: f.nameAr, type: "text", dir: "rtl" },
    { name: "category", label: f.category, type: "select", options: categories },
  ];
}

export function userFields(t: Dictionary, canMakeAdmin: boolean): FieldDef[] {
  const f = t.manage.f;
  const roles = (["MAINTENANCE_MANAGER", "COMPOUND_MANAGER", ...(canMakeAdmin ? ["ADMIN"] : [])] as const).map((r) => ({ value: r, label: t.roles[r as keyof typeof t.roles] }));
  return [
    { name: "name", label: f.name, type: "text", required: true },
    { name: "nameAr", label: f.nameAr, type: "text", dir: "rtl" },
    { name: "email", label: f.email, type: "email", required: true },
    { name: "phone", label: f.phone, type: "phone" },
    { name: "role", label: f.role, type: "select", required: true, options: roles },
    { name: "locale", label: f.locale, type: "select", required: true, options: [{ value: "ar", label: "العربية" }, { value: "en", label: "English" }] },
  ];
}
