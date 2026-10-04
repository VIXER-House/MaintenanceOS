import { AirVent, ArrowUpDown, Building2, Droplets, Flame, Hammer, Paintbrush, ShieldCheck, Sparkles, Trees, Wrench, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  PLUMBING: Droplets,
  ELECTRICAL: Zap,
  HVAC: AirVent,
  ELEVATOR: ArrowUpDown,
  CIVIL: Building2,
  PAINTING: Paintbrush,
  CARPENTRY: Hammer,
  APPLIANCES: Flame,
  SECURITY: ShieldCheck,
  CLEANING: Sparkles,
  LANDSCAPING: Trees,
  OTHER: Wrench,
};

export function CategoryIcon({ categoryKey, className }: { categoryKey?: string | null; className?: string }) {
  const Icon = ICONS[categoryKey ?? "OTHER"] ?? Wrench;
  return <Icon className={cn("h-4 w-4 text-muted-foreground", className)} />;
}
