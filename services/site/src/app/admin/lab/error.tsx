"use client"

import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function LabError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section aria-labelledby="lab-error-title" className="mx-auto flex min-h-[55vh] max-w-2xl items-center px-5 py-12 sm:px-8">
      <div className="w-full border border-destructive/40 bg-card/70 p-6 shadow-sm sm:p-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 id="lab-error-title" className="mt-4 text-2xl font-semibold tracking-tight">
          Lab could not load
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-6 text-muted-foreground">
          The current view failed before it could show reliable state. No successful action is being implied. Try loading
          the view again, or return to the current admin UI from the Lab header.
        </p>
        <Button type="button" className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </section>
  )
}
