/** Site owns hosted skill metadata; runtime discovery supplements that catalog. */
export function doctorMergeSkills(
  hostedSkills: Record<string, unknown>[],
  runtimeSkills: Record<string, unknown>[],
) {
  const byName = new Map<string, Record<string, unknown>>();
  // Replace whole records, not fields: removed credential requirements must stay removed.
  for (const skill of [...runtimeSkills, ...hostedSkills]) {
    if (typeof skill.name !== "string" || !skill.name.trim()) continue;
    byName.set(skill.name.trim(), skill);
  }
  if (!byName.has("imagegen")) byName.set("imagegen", { name: "imagegen", source: "codex-runtime" });
  return Array.from(byName.values());
}
