const discordForumChannelTypes = new Set([15, 16]);

export function discordDestinationType(
  declaredType: string | null | undefined,
  channelType: unknown,
): string {
  if (declaredType?.trim()) return declaredType.trim();
  return discordForumChannelTypes.has(Number(channelType))
    ? "discord-forum"
    : "discord-channel";
}
