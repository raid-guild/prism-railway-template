type ChatMessageTimestampProps = {
  value?: string | null;
  className?: string;
};

export function formatChatMessageTimestamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ChatMessageTimestamp({
  value,
  className,
}: ChatMessageTimestampProps) {
  const label = formatChatMessageTimestamp(value);
  if (!value || !label) return null;
  const date = new Date(value);

  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
      className={className}
      suppressHydrationWarning
    >
      {label}
    </time>
  );
}
