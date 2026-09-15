export type AdvisoryMemoryScope = {
  knowledgeSourceIds: string[];
  buckets: string[];
  instructions: string;
  enforcement: "instructions-only";
};

export function buildAdvisoryMemoryInstructions(scope: AdvisoryMemoryScope): string {
  const sources = scope.knowledgeSourceIds.map((value) => value.trim()).filter(Boolean);
  const buckets = scope.buckets.map((value) => value.trim()).filter(Boolean);
  const additional = scope.instructions.trim();
  if (sources.length === 0 && buckets.length === 0 && !additional) return "";

  const boundaries = [
    sources.length > 0 ? `knowledge source IDs: ${sources.join(", ")}` : "",
    buckets.length > 0 ? `buckets: ${buckets.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  return [
    "Advisory Prism Memory scope (model instructions only; not an enforced authorization boundary).",
    boundaries ? `Use Prism Memory context only from these configured selectors: ${boundaries}.` : "",
    additional,
    "Do not claim access to or rely on Prism Memory outside this configured scope. If the needed context is outside the scope or unavailable, say so instead of filling gaps from other Memory sources.",
  ].filter(Boolean).join(" ");
}
