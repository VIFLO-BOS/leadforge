"use client";

import { IMPORT_LIMITS, type ImportJob } from "@leadforge/contracts";
import { useRef, useState } from "react";
import { Button, ErrorState, FileDropzone, Progress } from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatBytes, formatNumber } from "@/lib/format";
import { useUploadImport } from "@/lib/hooks/use-imports";

/** Client-side checks before upload. The server re-checks everything (size, type, content). */
export function checkImportFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (!(IMPORT_LIMITS.acceptedExtensions as readonly string[]).includes(ext)) {
    return `“${file.name}” is not a CSV. Save the sheet as CSV (.csv), or upload a .tsv or .txt export. Excel workbooks (.xlsx) are not read directly.`;
  }
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > IMPORT_LIMITS.maxFileBytes) {
    return `“${file.name}” is ${formatBytes(file.size)}. Imports accept files up to ${formatBytes(IMPORT_LIMITS.maxFileBytes)}; split the file and import it in parts.`;
  }
  return null;
}

/** Specific guidance for each upload error the API documents. */
function uploadErrorText(err: unknown): { title: string; message: string } {
  if (isApiError(err)) {
    switch (err.code) {
      case "PAYLOAD_TOO_LARGE":
        return {
          title: "File too large",
          message: `Imports accept up to ${formatBytes(IMPORT_LIMITS.maxFileBytes)} and ${formatNumber(IMPORT_LIMITS.maxRows)} rows. Split the file and import it in parts.`,
        };
      case "UNSUPPORTED_MEDIA_TYPE":
        return {
          title: "Not a CSV file",
          message:
            "The file's type or content is not a CSV. Workbooks, PDFs, images and archives are refused even when renamed. Export the sheet as CSV and try again.",
        };
      case "IMPORT_INVALID":
        return { title: "The CSV could not be read", message: friendlyMessage(err) };
      case "RATE_LIMITED":
        return {
          title: "Too many uploads",
          message: "You can upload 30 files an hour. Wait a little and try again.",
        };
      case "FORBIDDEN":
        return { title: "Your role cannot import", message: friendlyMessage(err) };
      case "ORGANIZATION_PENDING_DELETION":
        return {
          title: "Imports are paused: this organization is scheduled for deletion",
          message: `${friendlyMessage(err)} The file was not uploaded.`,
        };
      default:
        break;
    }
  }
  return { title: "Upload failed", message: friendlyMessage(err) };
}

export function UploadStep({ onUploaded }: { onUploaded: (job: ImportJob) => void }) {
  const upload = useUploadImport();
  const [clientError, setClientError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState<{ loaded: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const start = (f: File) => {
    upload.reset();
    const problem = checkImportFile(f);
    setClientError(problem);
    setFile(f);
    if (problem) return;
    const controller = new AbortController();
    abort.current = controller;
    setSent({ loaded: 0, total: f.size });
    upload.mutate(
      {
        file: f,
        signal: controller.signal,
        onProgress: (loaded, total) => setSent({ loaded, total }),
      },
      {
        onSuccess: (job) => onUploaded(job),
        onSettled: () => {
          abort.current = null;
        },
      },
    );
  };

  const cancelled = upload.error instanceof DOMException && upload.error.name === "AbortError";
  const serverError = upload.isError && !cancelled ? uploadErrorText(upload.error) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FileDropzone
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        onFile={start}
        disabled={upload.isPending}
        title="Drag a CSV file here"
        buttonLabel="Choose a CSV file"
        error={clientError}
        description={
          <span className="flex flex-col gap-0.5">
            <span>
              Up to {formatBytes(IMPORT_LIMITS.maxFileBytes)} and{" "}
              {formatNumber(IMPORT_LIMITS.maxRows)} rows · .csv, .tsv or .txt
            </span>
            <span>Comma, semicolon or tab separated · UTF-8, UTF-16 or Windows-1252</span>
          </span>
        }
      />
      {upload.isPending && file ? (
        <div className="bg-surface-container-low flex min-w-0 flex-col gap-3 rounded-md p-4">
          <Progress
            label={`Uploading ${file.name}`}
            value={sent?.loaded ?? 0}
            max={sent?.total || file.size}
            valueText={
              sent && sent.loaded >= sent.total
                ? "Reading the file"
                : `${formatBytes(sent?.loaded ?? 0)} of ${formatBytes(file.size)}`
            }
            showLabel
          />
          <Button
            variant="text"
            size="sm"
            className="self-start"
            onClick={() => abort.current?.abort()}
          >
            Cancel upload
          </Button>
        </div>
      ) : null}
      {cancelled ? <p className="text-muted-foreground text-sm">Upload cancelled.</p> : null}
      {serverError ? (
        <ErrorState
          title={serverError.title}
          message={serverError.message}
          requestId={requestIdOf(upload.error)}
          onRetry={file ? () => start(file) : undefined}
          retryLabel="Try this file again"
        />
      ) : null}
    </div>
  );
}
