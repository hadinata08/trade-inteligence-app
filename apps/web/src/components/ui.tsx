import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-ink/85",
        secondary: "border border-ink/25 bg-card text-ink hover:border-ink/50",
        ghost: "text-ink hover:bg-black/5",
        danger: "bg-clay text-white",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-md border border-line bg-card", className)} {...props} />;
}

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = {
    neutral: "bg-paper text-ink/80",
    good: "bg-moss/10 text-moss",
    warn: "bg-soga/15 text-[oklch(0.42_0.09_58)]",
    bad: "bg-clay/10 text-clay",
  };
  return <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold", tones[tone], className)} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none ring-nila focus:ring-2", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none ring-nila focus:ring-2", props.className)} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-ink/70">{label}</span>
      {children}
    </label>
  );
}
