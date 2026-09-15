"use client"

import { useRef, useState } from "react"
import { LoaderCircle, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { readApiError } from "@/lib/client-api-errors"

export type UploadedMemoryArtifact = {
  id: string
  category: "memory"
  status: string
  source: string
  type: "working_document"
  title: string
  filename: string
  createdAt: string
  contentLength: number
  preview: string
  path: string
  viewUrl: string
}

export function MemoryDocumentUploadButton({
  disabled = false,
  label = "Upload document",
  onUploaded,
}: {
  disabled?: boolean
  label?: string
  onUploaded: (artifact: UploadedMemoryArtifact) => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setIsUploading(true)
    setError(null)
    const formData = new FormData()
    formData.set("file", file)
    try {
      const response = await fetch("/admin/memory/api/artifacts/upload", {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not upload document"))
      }
      const payload = await response.json() as {
        artifact?: UploadedMemoryArtifact
        error?: string
      }
      if (!payload.artifact) throw new Error(payload.error || "Upload did not return an artifact")
      await onUploaded(payload.artifact)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload document")
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || isUploading}
        onClick={() => inputRef.current?.click()}
      >
        {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {isUploading ? "Uploading" : label}
      </Button>
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
