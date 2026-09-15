export type DiscordAgentRoutingStatus = "configured" | "disabled" | "unavailable" | "unconfigured";

export function discordAgentRoutingStatus(policy: { mode: string; agentProfile?: unknown; agentResolutionFailed?: boolean }): DiscordAgentRoutingStatus {
  if (policy.agentResolutionFailed) return "unavailable";
  if (!policy.agentProfile) return "unconfigured";
  return policy.mode === "off" ? "disabled" : "configured";
}

export function unconfiguredDiscordChannelMessage(channelId: string) {
  return `Prism is connected, but no Agent Profile is configured for this Discord channel. Ask a workspace admin to assign one in Prism Lab → Agents. Channel: \`${channelId}\`.`;
}

export const unavailableDiscordAgentMessage = "Prism could not verify this channel's Agent Profile configuration. Please try again later.";
