"use client";

import { EXPORT_LIMITS, type CreateExportRequest } from "@leadforge/contracts";
import { FileArchive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  toast,
} from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/bulk";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { DOWNLOAD_LINK_MINUTES, EXPORT_RETENTION_DAYS, exportTooLargeMessage } from "@/lib/exports";
import { formatNumber } from "@/lib/format";
import { useCreateExport } from "@/lib/hooks/use-exports";
import { usePermissions } from "@/lib/hooks/use-permissions";

/** What every export file contains, said wherever an export is offered. */
export function ExportContents() {
  return (
    <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm">
      <li>
        A ZIP file with the businesses as a CSV (UTF-8; spreadsheet formulas are neutralized), plus{" "}
        <span className="text-foreground font-mono text-[13px]">ATTRIBUTION.txt</span> and the
        licence texts of the open data in it (a{" "}
        <span className="font-mono text-[13px]">LICENSES</span> folder). Keep them with the data
        when you share it.
      </li>
      <li>Suppressed businesses are never exported.</li>
      <li>
        Built in the background. You get a notification when it is ready; download links last{" "}
        {DOWNLOAD_LINK_MINUTES} minutes and the file is kept for {EXPORT_RETENTION_DAYS} days.
      </li>
    </ul>
  );
}

/**
 * Starts an asynchronous export (POST /exports) of the directory filters, a selection or a list,
 * then opens its job page, which polls and offers the download. One Idempotency-Key per opening of
 * the dialog, so a double click or a retried request returns the same export.
 */
export function ExportDialog({
  open,
  onOpenChange,
  request,
  what,
  count,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: CreateExportRequest | null;
  /** "the 240 businesses that match these filters", "list “Lagos pharmacies”". */
  what: string;
  /** Rows expected, when known (shown with the row cap). */
  count?: number | null;
}) {
  const router = useRouter();
  const { exportsAssignedOnly } = usePermissions();
  const create = useCreateExport();
  const key = useRef(newIdempotencyKey("export"));
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      key.current = newIdempotencyKey("export");
      setError(null);
      create.reset();
    }
  }, [open]);

  const tooLarge = exportTooLargeMessage(error);
  const overCap = typeof count === "number" && count > EXPORT_LIMITS.defaultRowCap;

  return (
    <Dialog open={open} onOpenChange={(o) => (create.isPending ? undefined : onOpenChange(o))}>
      <DialogContent size="md" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>Export businesses</DialogTitle>
          <DialogDescription>
            Export {what}
            {typeof count === "number"
              ? ` (${formatNumber(count)} ${count === 1 ? "business" : "businesses"})`
              : ""}
            .
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 pb-2">
          <ExportContents />
          {exportsAssignedOnly ? (
            <Banner
              tone="info"
              title="Only your assigned leads are exported"
              description="As a sales representative, your exports contain only businesses whose lead is assigned to you, whatever you select."
            />
          ) : null}
          {overCap ? (
            <p className="text-muted-foreground text-sm">
              Exports stop at the workspace&apos;s row limit (by default{" "}
              {formatNumber(EXPORT_LIMITS.defaultRowCap)} rows). If more match when the file is
              built, the export says so.
            </p>
          ) : null}
          {tooLarge ? (
            <Banner tone="warning" title="Too many rows for one export" description={tooLarge} />
          ) : error ? (
            <ErrorState
              title="Could not start the export"
              message={friendlyMessage(error)}
              requestId={requestIdOf(error)}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={
              !request || Boolean(tooLarge) || (isApiError(error) && error.code === "RATE_LIMITED")
            }
            onClick={() =>
              request &&
              create.mutate(
                { body: request, key: key.current },
                {
                  onSuccess: (job) => {
                    onOpenChange(false);
                    toast.success("Export started", {
                      description:
                        "The file is being built. You will be notified when it is ready.",
                    });
                    router.push(`/app/jobs/exports/${job.id}`);
                  },
                  onError: setError,
                },
              )
            }
          >
            <FileArchive aria-hidden /> Create export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
