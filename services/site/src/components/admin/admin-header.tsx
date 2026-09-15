import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, BookOpen } from "lucide-react";

import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";

export function AdminHeader({
  actions,
  branding,
}: {
  actions: ReactNode;
  branding?: {
    brandName?: string;
    logoUrl?: string;
    logoAlt?: string;
    workspaceLabel?: string;
  };
}) {
  const brandName = branding?.brandName?.trim() || "Prism Refactory";
  const workspaceLabel = branding?.workspaceLabel?.trim() || "Admin workspace";
  const logoUrl = branding?.logoUrl?.trim() || "";

  return (
    <div className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur">
      <div className="flex min-h-16 items-center justify-between gap-4 px-5 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-muted/40">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={branding?.logoAlt?.trim() || `${brandName} logo`}
                className="h-full w-full object-contain p-1"
              />
            ) : (
              <Activity className="h-4 w-4 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              {brandName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {workspaceLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {actions}
          <Button asChild variant="outline">
            <Link href="/docs" aria-label="Open docs">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Docs</span>
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
