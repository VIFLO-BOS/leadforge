"use client";

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
  Heading,
  TextField,
  toast,
} from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf, retryWaitFrom, validationDetails } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useRequestDeletion } from "@/lib/hooks/use-org-lifecycle";
import { DELETED_ITEMS, GRACE_DAYS, KEPT_ITEMS, purgeDateFrom } from "@/lib/org-lifecycle";

/**
 * Owner-only "Delete organization" (POST /organizations/current/deletion-requests). Says exactly
 * what is deleted, what is kept and when, then asks for the organization's name, typed, and the
 * owner's current password. A wrong password is REAUTH_FAILED (403, the session is fine) and counts
 * toward the per-account sign-in lock (429 with the wait). Focus moves to the first invalid field.
 */
export function DeleteOrganizationDialog({
  open,
  onOpenChange,
  organizationName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationName: string;
}) {
  const request = useRequestDeletion();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // The purge date this request would get, fixed when the dialog opens.
  const [purgeDate, setPurgeDate] = useState(() => purgeDateFrom());

  useEffect(() => {
    if (open) {
      setPurgeDate(purgeDateFrom());
      return;
    }
    setName("");
    setPassword("");
    setErrors({});
    request.reset();
    // Reset on close only.
  }, [open]);

  const rateLimited = isApiError(request.error) && request.error.code === "RATE_LIMITED";
  const handled =
    isApiError(request.error) &&
    (request.error.code === "REAUTH_FAILED" ||
      request.error.code === "RATE_LIMITED" ||
      (request.error.code === "VALIDATION_FAILED" &&
        Boolean(validationDetails(request.error).confirmName)));
  const generic = request.isError && !handled ? request.error : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: { name?: string; password?: string } = {};
    if (name.trim() !== organizationName) {
      next.name = name.trim()
        ? `The name does not match. Type “${organizationName}” exactly.`
        : `Type the organization's name, “${organizationName}”, to confirm.`;
    }
    if (!password) next.password = "Enter your current password.";
    setErrors(next);
    if (next.name) {
      nameRef.current?.focus();
      return;
    }
    if (next.password) {
      passwordRef.current?.focus();
      return;
    }
    request.mutate(
      { confirmName: name.trim(), password },
      {
        onSuccess: (status) => {
          onOpenChange(false);
          toast.success(`Deletion scheduled for ${formatDate(status.purgeAfter)}`, {
            description:
              "Every member sees a banner until then. Any owner can cancel it in Settings, Organization.",
          });
        },
        onError: (err) => {
          if (!isApiError(err)) return;
          if (err.code === "REAUTH_FAILED") {
            setErrors({
              password: "That password is not correct. Enter your current LeadForge password.",
            });
            setPassword("");
            passwordRef.current?.focus();
          } else if (err.code === "VALIDATION_FAILED") {
            const server = validationDetails(err);
            if (server.confirmName) {
              setErrors({ name: `The name does not match. Type “${organizationName}” exactly.` });
              nameRef.current?.focus();
            }
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (request.isPending ? undefined : onOpenChange(o))}>
      <DialogContent size="lg" data-testid="delete-org-dialog">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Delete this organization?</DialogTitle>
            <DialogDescription>
              The purge starts on{" "}
              <strong className="text-foreground font-medium" data-testid="delete-org-purge-date">
                {formatDate(purgeDate)}
              </strong>
              , {GRACE_DAYS} days from now. Until then the workspace keeps working and any owner can
              cancel.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
            <div className="grid min-w-0 grid-cols-1 gap-4 min-[640px]:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <Heading className="text-sm font-medium">Deleted</Heading>
                <ul
                  className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm"
                  data-testid="delete-org-deleted"
                >
                  {DELETED_ITEMS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Heading className="text-sm font-medium">Kept</Heading>
                <ul
                  className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm"
                  data-testid="delete-org-kept"
                >
                  {KEPT_ITEMS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-sm">
              Until the purge, new discovery, website analysis, imports, purchases and invitations
              are paused; reads, exports and lead work continue. Export the organization&apos;s data
              first if you need a copy.
            </p>
            <TextField
              ref={nameRef}
              id="org-delete-name"
              label="Organization name"
              required
              autoComplete="off"
              spellCheck={false}
              hint={`Type “${organizationName}” exactly.`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((x) => ({ ...x, name: undefined }));
              }}
              error={errors.name}
            />
            <TextField
              ref={passwordRef}
              id="org-delete-password"
              label="Your current password"
              type="password"
              revealable
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
              }}
              error={errors.password}
            />
            {rateLimited ? (
              <Banner
                tone="warning"
                title="Too many password attempts"
                description={`Password checks for your account are paused${
                  retryWaitFrom(request.error)
                    ? `; try again in ${retryWaitFrom(request.error)}`
                    : "; try again later"
                }. Signing in is paused for the same time.`}
                data-testid="delete-org-rate-limited"
              />
            ) : null}
            {generic ? (
              <ErrorState
                title="Could not schedule the deletion"
                message={friendlyMessage(generic)}
                requestId={requestIdOf(generic)}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="text"
              onClick={() => onOpenChange(false)}
              disabled={request.isPending}
            >
              Keep the organization
            </Button>
            <Button
              type="submit"
              variant="destructive"
              loading={request.isPending}
              data-testid="delete-org-submit"
            >
              Delete organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
