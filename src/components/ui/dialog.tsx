"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, side, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: "center" | "end" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 grid gap-4 border bg-card p-6 shadow-xl duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          side === "end"
            ? "inset-y-0 end-0 h-full w-full max-w-lg overflow-y-auto data-[state=open]:slide-in-from-right ltr:data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left"
            : "start-1/2 top-1/2 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-y-1/2 overflow-y-auto rounded-lg ltr:-translate-x-1/2 rtl:translate-x-1/2",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute end-4 top-4 rounded-sm opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...p} />;
}
export function DialogTitle({ className, ...p }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...p} />;
}
export function DialogDescription({ className, ...p }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;
}
export function DialogFooter({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap justify-end gap-2", className)} {...p} />;
}
