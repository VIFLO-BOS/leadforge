"use client";

import { ROLE_LABELS, type InvitationPreview } from "@leadforge/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ErrorState, Skeleton } from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { setActiveOrgId } from "@/lib/org";
import { AuthHeading } from "./auth-heading";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
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
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (preview.isError) {
    return (
      <>
        <AuthHeading title="Invitation not available" />
        <ErrorState
          title="We could not load this invitation"
          message={friendlyMessage(
            preview.error,
            "This invitation may have expired or been revoked.",
          )}
          requestId={requestIdOf(preview.error)}
          onRetry={() => void preview.refetch()}
        />
        <p className="text-muted-foreground mt-6 text-center text-sm">
          <Link
            href="/sign-in"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Go to sign in
          </Link>
        </p>
      </>
    );
  }

  const inv = preview.data;

  return (
    <>
      <AuthHeading
        title={`Join ${inv.organizationName}`}
        description={
          <>
            You were invited as <Badge variant="primary">{ROLE_LABELS[inv.role]}</Badge> using{" "}
            <span className="break-anywhere text-foreground font-medium">{inv.email}</span>.
          </>
        }
      />
      <p className="text-muted-foreground mb-4 text-xs">
        This invitation expires on {new Date(inv.expiresAt).toLocaleDateString()}. Sign in or create
        an account with the same email before accepting.
      </p>
      {error ? (
        <ErrorState
          title="Could not accept"
          message={error.message}
          requestId={error.requestId}
          className="mb-4"
        />
      ) : null}
      <div className="flex flex-col gap-2">
        <Button size="lg" className="w-full" onClick={accept} loading={accepting}>
          Accept invitation
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href={`/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`}>
            Create an account first
          </Link>
        </Button>
      </div>
    </>
  );
}
