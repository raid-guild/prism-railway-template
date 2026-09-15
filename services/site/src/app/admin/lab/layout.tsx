import type { Metadata } from "next"

import { LoginCard } from "@/components/admin/login-card"
import { LabShell } from "@/components/prism-lab/lab-shell"
import { requireAdminSession } from "@/lib/admin-auth"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"
import {
  getAccountabilityAssignment,
  getAccountabilityDomain,
  listAgentProfileQueueStates,
  listAgentProfiles,
} from "@/lib/app-core"
import { isPrismMemoryConfigured } from "@/lib/prism-memory"
import { currentSiteBranding } from "@/lib/site-branding"

export const metadata: Metadata = {
  title: "Lab | Prism Refactory",
  description: "The field-testable Prism operations workspace.",
}

export const dynamic = "force-dynamic"

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const enabled = isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)
  const access = enabled ? await requireAdminSession() : null
  const queueByProfile = access?.ok && access.capabilities.includes("canChatAgents")
    ? new Map(listAgentProfileQueueStates().map((queue) => [queue.profileId, queue]))
    : new Map()
  const agents = access?.ok && access.capabilities.includes("canChatAgents")
    ? listAgentProfiles().filter((profile) => access.capabilities.includes("canRunAgent") || profile.systemKey !== "admin-agent").map(({ id, key, name, avatarUrl, accentColor, systemKey, status }) => {
        const assignment = getAccountabilityAssignment("agent_profile", id)
        const domain = assignment ? getAccountabilityDomain(assignment.domainKey) : null
        const categoryLabel = typeof domain?.governanceRef.stewardMandate === "string"
          ? domain.governanceRef.stewardMandate
          : domain?.name ?? null
        const categoryOrder = typeof domain?.governanceRef.displayOrder === "number"
          ? domain.governanceRef.displayOrder
          : 999
        return {
          key,
          name,
          avatarUrl,
          accentColor,
          systemKey,
          status,
          domainKey: domain?.key ?? null,
          domainName: domain?.name ?? null,
          categoryLabel,
          categoryOrder,
          domainStewards: domain?.stewards.map((steward) => steward.displayName || steward.userId) ?? [],
          queue: queueByProfile.get(id) ?? { profileId: id, queued: 0, claimed: 0, running: 0 },
        }
      })
    : []

  return (
    <LabShell enabled={enabled} capabilities={access?.ok ? access.capabilities : []} agents={agents} memoryConfigured={isPrismMemoryConfigured()} branding={currentSiteBranding()}>
      {access?.ok ? children : <LoginCard error="Sign in to access the live Prism Lab workspace." returnTo="/admin/lab" />}
    </LabShell>
  )
}
