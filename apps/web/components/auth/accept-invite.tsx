"use client";

import { ROLE_LABELS, type InvitationPreview } from "@leadforge/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ErrorState, Skeleton } from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { isPendingDeletion, pendingDeletionPurgeAfter } from "@/lib/org-lifecycle";
import { setActiveOrgId } from "@/lib/org";
import { AuthLink, AuthPanel } from "./auth-heading";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<{
    title?: string;
    message: string;
    requestId?: string;
  } | null>(null);
  const [accepting, setAccepting] = useState(false);

  const preview = useQuery({
    queryKey: ["invitations", token],
    queryFn: () =>
      apiFetch<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`, { noOrg: true }),
    retry: false,
  });

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const result = await apiFetch<{ organizationId?: string }>(
        `/invitations/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          noOrg: true,
        },
      );
      if (result?.organizationId) setActiveOrgId(result.organizationId);
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      router.push("/app");
    } catch (err) {
      if (isApiError(err) && err.code === "UNAUTHENTICATED") {
        router.push(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
        return;
      }
      if (isPendingDeletion(err)) {
        const date = pendingDeletionPurgeAfter(err);
        setError({
          title: "This organization is being deleted",
          message: `It is scheduled for deletion${date ? ` on ${formatDate(date)}` : ""}, so it is not taking new members. If you expected to join, contact the person who invited you.`,
          requestId: requestIdOf(err),
        });
        return;
      }
      setError({
        message: friendlyMessage(err, "The invitation could not be accepted."),
        requestId: requestIdOf(err),
      });
    } finally {
      setAccepting(false);
    }
  };

  if (preview.isPending) {
    return (
      <div
        className="flex flex-col gap-4"
        role="status"
        aria-busy="true"
        aria-label="Loading invitation"
      >
        <Skeleton className="size-11 rounded-xl" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-40 self-end rounded-full" />
      </div>
    );
  }

  if (preview.isError) {
    return (
      <AuthPanel
        title="Invitation not available"
        description="This invitation may have expired or been revoked."
      >
        <div className="flex flex-col gap-5">
          <ErrorState
            title="We could not load this invitation"
            message={friendlyMessage(
              preview.error,
              "This invitation may have expired or been revoked.",
            )}
            requestId={requestIdOf(preview.error)}
            onRetry={() => void preview.refetch()}
          />
          <AuthLink href="/sign-in">Go to sign in</AuthLink>
        </div>
      </AuthPanel>
    );
  }

  const inv = preview.data;

  return (
    <AuthPanel
      title={`Join ${inv.organizationName}`}
      description={
        <>
          You were invited as <Badge variant="primary">{ROLE_LABELS[inv.role]}</Badge> using{" "}
          <span className="break-anywhere font-medium">{inv.email}</span>.
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-muted-foreground text-sm">
          This invitation expires on {new Date(inv.expiresAt).toLocaleDateString()}. Sign in or
          create an account with the same email before accepting.
        </p>
        {error ? (
          <ErrorState
            title={error.title ?? "Could not accept"}
            message={error.message}
            requestId={error.requestId}
          />
        ) : null}
        <div className="mt-2 flex flex-col-reverse gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
          <Button asChild variant="text" className="-ml-3 self-start min-[360px]:self-auto">
            <Link href={`/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`}>
              Create an account first
            </Link>
          </Button>
          <Button onClick={accept} loading={accepting}>
            Accept invitation
          </Button>
        </div>
      </div>
    </AuthPanel>
  );
}
