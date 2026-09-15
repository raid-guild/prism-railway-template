export const agentAccentPalette = [
  { key: "lime", label: "Prism Lime", value: "#B7F500" },
  { key: "yellow", label: "Signal Yellow", value: "#FFE14A" },
  { key: "orange", label: "Solar Orange", value: "#FF8A34" },
  { key: "pink", label: "Neon Pink", value: "#FF4FD8" },
  { key: "violet", label: "Ultraviolet", value: "#A970FF" },
  { key: "blue", label: "Electric Blue", value: "#4D8DFF" },
  { key: "cyan", label: "Laser Cyan", value: "#36E7FF" },
  { key: "green", label: "Plasma Green", value: "#35F29A" },
] as const;

export function normalizeAgentAccentColor(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return (
    agentAccentPalette.find((item) => item.value === normalized)?.value ?? null
  );
}

export function agentAccentColorForKey(key: string) {
  let hash = 0;
  for (const character of key)
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return (
    agentAccentPalette[Math.abs(hash) % agentAccentPalette.length]?.value ??
    agentAccentPalette[0].value
  );
}
