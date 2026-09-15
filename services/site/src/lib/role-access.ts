export const roleSlugs = ["admin", "moderator", "member"] as const

export type RoleSlug = (typeof roleSlugs)[number]

export const capabilities = [
  "canViewWorkspace",
  "canViewMemory",
  "canChatAgents",
  "canViewRequests",
  "canCreateRequest",
  "canComment",
  "canRunAgent",
  "canManageTasks",
  "canManageWorkflows",
  "canManageSkills",
  "canManageMemorySources",
  "canManageSettings",
  "canManageUsers",
] as const

export type Capability = (typeof capabilities)[number]

const roleCapabilities: Record<RoleSlug, Capability[]> = {
  admin: [...capabilities],
  moderator: [
    "canViewWorkspace",
    "canViewMemory",
    "canChatAgents",
    "canViewRequests",
    "canCreateRequest",
    "canComment",
    "canRunAgent",
    "canManageTasks",
    "canManageWorkflows",
    "canManageSkills",
    "canManageMemorySources",
  ],
  member: [
    "canViewWorkspace",
    "canViewMemory",
    "canChatAgents",
    "canViewRequests",
    "canCreateRequest",
    "canComment",
  ],
}

export function normalizeRoleSlugs(values: readonly string[] | null | undefined): RoleSlug[] {
  const normalized = new Set<RoleSlug>()
  for (const value of values ?? []) {
    if (roleSlugs.includes(value as RoleSlug)) {
      normalized.add(value as RoleSlug)
    }
  }
  return [...normalized]
}

export function capabilitiesForRoles(values: readonly string[] | null | undefined) {
  const granted = new Set<Capability>()
  for (const role of normalizeRoleSlugs(values)) {
    for (const capability of roleCapabilities[role]) {
      granted.add(capability)
    }
  }
  return granted
}

export function hasCapability(values: readonly string[] | null | undefined, capability: Capability) {
  return capabilitiesForRoles(values).has(capability)
}
