import { redirect } from "next/navigation"

export default function LabConsolePage() {
  redirect("/admin/lab/agents/admin-agent")
}
