"use client";

import * as React from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { THEME_STORAGE_KEY } from "../lib/theme";

type Theme = "light" | "dark";

function getCurrentTheme(): Theme {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  // null until mounted: the server cannot know the client's theme.
  const [theme, setTheme] = React.useState<Theme | null>(null);

  React.useEffect(() => {
    setTheme(getCurrentTheme());
  }, []);

  const toggle = () => {
    const next: Theme = getCurrentTheme() === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked; the choice still applies for this page view.
    }
    setTheme(next);
  };

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
