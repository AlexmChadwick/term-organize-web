"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Button({
  variant = "solid",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "ghost" | "soft" }) {
  return <button className={cn("btn", variant === "ghost" && "ghost", variant === "soft" && "soft", className)} {...props} />;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("field", props.className)} {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("area", props.className)} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("select", props.className)} {...props} />;
}

export function Modal({
  open,
  onOpenChange,
  title,
  trigger,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  trigger?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(560px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[22px] border border-line bg-surface p-5 shadow-2xl">
          <div className="mb-3 flex items-start justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
            <Dialog.Close className="btn ghost tiny" type="button">
              Close
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
