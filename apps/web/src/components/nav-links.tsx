"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="-mb-px flex min-w-0 flex-1 gap-1 self-stretch overflow-x-auto" aria-label="Navigasi utama">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isActive(link.href) ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center border-b-2 px-3 text-sm font-medium",
            isActive(link.href) ? "border-nila text-nila" : "border-transparent text-ink/65 hover:text-ink",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
