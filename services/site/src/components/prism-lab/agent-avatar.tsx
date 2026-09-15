import { Bot } from "lucide-react"

import { cn } from "@/lib/utils"

export function AgentAvatar({ name, avatarUrl, accentColor, className }: { name: string; avatarUrl?: string | null; accentColor?: string | null; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")
  return (
    <span className={cn("relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-primary/10 text-xs font-semibold text-primary", className)} style={accentColor ? { borderColor: accentColor, backgroundColor: `${accentColor}1F`, color: accentColor } : undefined}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : initials ? <span aria-hidden="true">{initials}</span> : <Bot className="h-4 w-4" aria-hidden="true" />}
      <span className="sr-only">{name}</span>
    </span>
  )
}
