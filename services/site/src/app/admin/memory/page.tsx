import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";

import { LoginCard } from "@/components/admin/login-card";
import { MemoryExplorerWorkspace } from "@/components/admin/memory-explorer-workspace";
import { AdminHeader } from "@/components/admin/admin-header";
import { Button } from "@/components/ui/button";
import { getAdminWorkspaceData } from "@/lib/admin";

export default async function AdminMemoryPage() {
  const workspace = await getAdminWorkspaceData();

  if (!workspace.ok) {
    const error =
      workspace.reason === "unauthorized"
        ? "That password did not authenticate against the API."
        : workspace.reason === "missing-password"
          ? "Enter the shared admin password."
          : "The admin API could not be reached.";

    return <LoginCard error={error} />;
  }

  if (!workspace.data.setup.prismMemory.configured) {
    return (
      <main className="min-h-screen w-full bg-background text-foreground">
        <AdminHeader
          branding={workspace.data.branding}
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/admin">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Change Board</span>
                </Link>
              </Button>
              <form action="/admin/logout" method="post">
                <Button variant="outline" type="submit">
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Logout</span>
                </Button>
              </form>
            </>
          }
        />

        <section className="mx-auto max-w-3xl px-5 py-12 md:px-6">
          <div className="rounded-xl border border-border bg-card/40 p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Prism Memory
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Memory Explorer is not configured
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Set <code>PRISM_MEMORY_BASE_URL</code> on the <code>site</code>{" "}
              service so the admin UI can reach Prism Memory.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Optional: set <code>PRISM_API_READ_KEY</code> when the deployment
              uses split Prism Memory keys. Older single-key deployments can
              keep using <code>PRISM_API_KEY</code>.
            </p>
            {workspace.data.setup.prismMemory.error ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Current status: {workspace.data.setup.prismMemory.error}
              </p>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full bg-background text-foreground">
      <AdminHeader
        branding={workspace.data.branding}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Change Board</span>
              </Link>
            </Button>
            <form action="/admin/logout" method="post">
              <Button variant="outline" type="submit">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </form>
          </>
        }
      />

      <MemoryExplorerWorkspace setup={workspace.data.setup} />
    </main>
  );
}
