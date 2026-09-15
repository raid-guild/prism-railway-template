import { ChangeBoard } from "@/components/admin/change-board"
import { LoginCard } from "@/components/admin/login-card"
import { getAdminWorkspaceData } from "@/lib/admin"
import Link from "next/link"
import { redirect } from "next/navigation"
import { shouldRedirectAdminToLab } from "@/lib/prism-lab/admin-entry"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const errorParam = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error
  const tabParam = Array.isArray(resolvedSearchParams.tab)
    ? resolvedSearchParams.tab[0]
    : resolvedSearchParams.tab

  const board = await getAdminWorkspaceData()

  if (!board.ok) {
    const error =
      board.reason === "unauthorized"
        ? "That password did not authenticate against the API."
        : errorParam === "missing-password"
          ? "Enter the shared admin password."
          : board.reason === "error"
            ? "The board could not load the admin API."
            : undefined

    return <LoginCard error={error} />
  }

  if (shouldRedirectAdminToLab(resolvedSearchParams, process.env.PRISM_LAB_ENABLED)) {
    redirect("/admin/lab")
  }

  return <>
    {isPrismLabEnabled(process.env.PRISM_LAB_ENABLED) && <nav aria-label="Workspace switcher" className="border-b border-border bg-card px-5 py-3 text-sm">
      <span className="text-muted-foreground">Legacy workspace · settings and configuration remain available here.</span>{" "}
      <Link href="/admin/lab" className="text-primary underline">Return to Prism Lab</Link>
    </nav>}
    <ChangeBoard data={board.data} initialTab={tabParam} />
  </>
}
