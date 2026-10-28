"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  cn,
} from "@leadforge/ui";
import { MARKETING_NAV } from "@/lib/site";
import { Logo } from "./logo";

/**
 * Sticky marketing nav: 64px from 768px, 56px below. The hairline and shadow fade in over the
 * first 48px of scroll with a CSS scroll-driven animation (progressive enhancement; browsers
 * without scroll timelines show them from the start). Under 768px a full-screen sheet menu.
 */
export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-40 backdrop-blur-xl">
      <span
        aria-hidden
        className="sda-nav-elevation border-border pointer-events-none absolute inset-x-0 bottom-0 h-px border-b"
      />
      <div className="container-marketing flex h-14 min-w-0 items-center gap-2 md:h-16">
        <Logo className="mr-2 lg:mr-6" />

        <nav aria-label="Primary" className="hidden min-w-0 items-center gap-1 md:flex">
          {MARKETING_NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "state-layer transition-ui rounded-full px-4 py-2 text-sm font-medium",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button asChild variant="text" size="md">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="md">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto md:hidden"
              aria-label="Open menu"
            >
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="full" hideClose className="bg-background">
            <div className="page-pad flex h-14 shrink-0 items-center justify-between gap-2">
              <Logo />
              <SheetClose asChild>
                <Button variant="ghost" size="icon" aria-label="Close menu">
                  <X aria-hidden />
                </Button>
              </SheetClose>
            </div>
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Site navigation</SheetDescription>
            <nav
              aria-label="Mobile"
              className="page-pad flex min-h-0 flex-1 flex-col overflow-y-auto pb-6 pt-4"
            >
              <ul className="flex flex-col">
                {MARKETING_NAV.map((item) => (
                  <li key={item.href} className="border-border border-b">
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className="aria-[current=page]:text-primary flex min-h-14 items-center justify-between gap-3 text-lg font-normal leading-7"
                    >
                      {item.label}
                      <ArrowRight aria-hidden className="text-muted-foreground size-5 shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-3 pt-8">
                <Button asChild size="lg" className="w-full">
                  <Link href="/sign-up" onClick={() => setOpen(false)}>
                    Get started
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full">
                  <Link href="/sign-in" onClick={() => setOpen(false)}>
                    Sign in
                  </Link>
                </Button>
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
