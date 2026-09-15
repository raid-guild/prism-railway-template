import { redirect } from "next/navigation"
import { createAuditLog, createChangeRequest, getDefaultTargetEnvironmentForApp, getTargetApp, getWorkflowByKey } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import {
  requireLocalAdminAccess,
  trackedChangeRequestPriorities,
  trackedChangeRequestTypes,
  useLocalAppApi,
} from "@/lib/local-admin-api"
import { parseEstimatedHumanHours } from "@/lib/request-estimates"
import { autoStartWorkflowRequest } from "@/lib/workflow-autostart"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const title = String(formData.get("title") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const requestType = String(formData.get("requestType") ?? "bug").trim()
  const priority = String(formData.get("priority") ?? "normal").trim()
  const targetAppId = String(formData.get("targetAppId") ?? "").trim()
  const workflowKey = String(formData.get("workflowKey") ?? "change-request-default").trim() || "change-request-default"
  const rawEstimatedHumanHours = formData.get("estimatedHumanHours") ?? formData.get("estimated_human_hours")
  const hasEstimatedHumanHours = rawEstimatedHumanHours !== null
  const estimatedHumanHours = parseEstimatedHumanHours(rawEstimatedHumanHours)

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      redirect("/admin?error=unauthorized")
    }

    const workflow = getWorkflowByKey(workflowKey)
    const target = workflow?.definition?.target
    const targetRequired = workflowKey === "change-request-default"
      || (isRecord(target) && target.required === true)
    const targetApp = targetAppId ? getTargetApp(targetAppId) : null

    if (
      !title ||
      !description ||
      !workflow ||
      !workflow.enabled ||
      (targetRequired && !targetAppId) ||
      (targetAppId && (!targetApp || !targetApp.agentEnabled)) ||
      !trackedChangeRequestTypes.includes(requestType as typeof trackedChangeRequestTypes[number]) ||
      !trackedChangeRequestPriorities.includes(priority as typeof trackedChangeRequestPriorities[number]) ||
      (hasEstimatedHumanHours && estimatedHumanHours === undefined)
    ) {
      redirect("/admin?error=request-create")
    }

    const changeRequest = createChangeRequest({
      title,
      description,
      workflowKey,
      requestType,
      priority,
      source: "manual",
      requestedByUserId: access.userId,
      targetAppId: targetAppId || null,
      targetEnvironmentId: targetAppId ? getDefaultTargetEnvironmentForApp(targetAppId)?.id ?? null : null,
      estimatedHumanHours: estimatedHumanHours ?? null,
      acceptanceCriteria: [],
      constraints: {},
      attachments: [],
    })

    createAuditLog({
      actorUserId: access.userId,
      actionType: "admin.change_board_request.create",
      targetType: "change_request",
      targetId: changeRequest?.id ?? null,
      meta: { requestType, priority, workflowKey, targetAppId: targetAppId || null },
    })
    if (changeRequest) {
      const origin = new URL(request.url).origin
      const autoStart = await autoStartWorkflowRequest(changeRequest, { baseUrl: origin })
      if (autoStart.reason && autoStart.reason !== "current_step_is_not_agent") {
        console.warn(JSON.stringify({
          event: "workflow.autostart_failed",
          requestId: changeRequest.id,
          reason: autoStart.reason,
          status: autoStart.status ?? null,
          error: autoStart.error ?? null,
        }))
      }
    }

    redirect("/admin")
  }

  const response = await adminFetch("/api/admin/change-board/requests", {
    method: "POST",
    body: JSON.stringify({
      title,
      description,
      requestType,
      priority,
      workflowKey,
      targetAppId: targetAppId || null,
      estimatedHumanHours: estimatedHumanHours ?? null,
    }),
  })

  if (response.status === 401) {
    redirect("/admin?error=unauthorized")
  }

  redirect("/admin")
}
