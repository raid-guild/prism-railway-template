const adminReturnPaths = new Set(["/admin", "/admin/lab"])

export function safeAdminReturnPath(value: unknown) {
  return typeof value === "string" && adminReturnPaths.has(value) ? value : "/admin"
}
