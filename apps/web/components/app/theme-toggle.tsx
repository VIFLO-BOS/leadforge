"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@leadforge/ui";

/** Light, dark or system. Radio items so the current choice is announced. */
export function ThemeRadioGroup() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
      <DropdownMenuRadioItem value="light">
        <Sun aria-hidden /> Light
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">
        <Moon aria-hidden /> Dark
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system">
        <Monitor aria-hidden /> System
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

export function ThemeToggle() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Sun aria-hidden className="dark:hidden" />
          <Moon aria-hidden className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <ThemeRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
