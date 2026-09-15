export type PublicOutputSanitizerRedaction = {
  label: string;
  count: number;
};

export type PublicOutputSanitizerResult = {
  text: string;
  redactions: PublicOutputSanitizerRedaction[];
};

type SanitizerRule = {
  label: string;
  pattern: RegExp;
  replacement: string | ((match: string, ...args: string[]) => string);
};

const sanitizerRules: SanitizerRule[] = [
  {
    label: "railway-private-url",
    pattern: /\bhttps?:\/\/[^\s<>"')\]]*\.railway\.internal(?::\d+)?[^\s<>"')\]]*/gi,
    replacement: "[redacted internal URL]",
  },
  {
    label: "railway-private-host",
    pattern: /\b[a-z0-9-]+\.railway\.internal(?::\d+)?\b/gi,
    replacement: "[redacted internal host]",
  },
  {
    label: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    replacement: "Bearer [redacted]",
  },
  {
    label: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[redacted private key]",
  },
  {
    label: "secret-assignment",
    pattern: /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*[:=]\s*)(["']?)[^\s"',}]{8,}\2/gi,
    replacement: (_match, prefix) => `${prefix}[redacted]`,
  },
  {
    label: "github-token",
    pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,})\b/g,
    replacement: "[redacted GitHub token]",
  },
  {
    label: "openai-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[redacted API key]",
  },
  {
    label: "local-project-path",
    pattern: /(?<![:/\w.-])\/(?:home|Users|workspace|app|data)\/[^\s<>"')\]]{8,}/g,
    replacement: "[redacted local path]",
  },
];

export function sanitizePublicOutput(value: string): PublicOutputSanitizerResult {
  let text = value;
  const redactions: PublicOutputSanitizerRedaction[] = [];

  for (const rule of sanitizerRules) {
    let count = 0;
    text = text.replace(rule.pattern, (match, ...args) => {
      count += 1;
      return typeof rule.replacement === "function"
        ? rule.replacement(match, ...args)
        : rule.replacement;
    });
    if (count > 0) {
      redactions.push({ label: rule.label, count });
    }
  }

  return { text, redactions };
}
