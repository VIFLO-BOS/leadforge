"use client";

import {
  ROLE_LABELS,
  roleHasPermission,
  type InvitationSummary,
  type MemberSummary,
} from "@leadforge/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useState } from "react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusIndicator,
  initials,
  toast,
} from "@leadforge/ui";
import { apiFetch, apiFetchPaged } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { useWorkspace } from "../app-shell";
import { InviteMemberDialog } from "./invite-member-dialog";

export function TeamPage() {
  const { org, me } = useWorkspace();
  const queryClient = useQueryClient();
  const canManage = roleHasPermission(org.role, "members:manage");
  const [revokeTarget, setRevokeTarget] = useState<InvitationSummary | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberSummary | null>(null);

  const members = useQuery({
    queryKey: ["org", org.id, "members"],
    queryFn: () => apiFetchPaged<MemberSummary>("/organizations/current/members?pageSize=100"),
  });

  const invitations = useQuery({
    queryKey: ["org", org.id, "invitations"],
    queryFn: () => apiFetchPaged<InvitationSummary>("/organizations/current/invitations"),
    enabled: canManage,
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/organizations/current/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Invitation revoked");
      void queryClient.invalidateQueries({ queryKey: ["org", org.id, "invitations"] });
    },
    onError: (err) => toast.error(friendlyMessage(err)),
    onSettled: () => setRevokeTarget(null),
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/organizations/current/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Member removed");
      void queryClient.invalidateQueries({ queryKey: ["org", org.id, "members"] });
    },
    onError: (err) => toast.error(friendlyMessage(err)),
    onSettled: () => setRemoveTarget(null),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team Members"
        description={`People with access to ${org.name} and the role each one holds.`}
        actions={canManage ? <InviteMemberDialog organizationId={org.id} /> : null}
      />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          {members.isPending ? (
            <ul className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-40 max-w-full" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                </li>
              ))}
            </ul>
          ) : members.isError ? (
            <ErrorState
              message={friendlyMessage(members.error)}
              requestId={requestIdOf(members.error)}
              onRetry={() => void members.refetch()}
            />
          ) : members.data.data.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No members found"
              description="This is unexpected. Refresh to try again."
            />
          ) : (
            <ul className="divide-border divide-y">
              {members.data.data.map((m) => {
                const isSelf = m.userId === me.user.id;
                const removable =
                  canManage &&
                  !isSelf &&
                  (m.role !== "owner" || roleHasPermission(org.role, "members:manage_owners"));
                return (
                  <li
                    key={m.userId}
                    className="flex min-w-0 flex-col gap-2 py-3 min-[480px]:flex-row min-[480px]:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar>
                        <AvatarFallback>{initials(m.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {m.name}
                          {isSelf ? (
                            <span className="text-muted-foreground ml-1 text-xs">(you)</span>
                          ) : null}
                        </p>
                        <p className="break-anywhere text-muted-foreground text-xs">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-11 min-[480px]:pl-0">
                      <Badge variant={m.role === "owner" ? "primary" : "neutral"}>
                        {ROLE_LABELS[m.role]}
                      </Badge>
                      {m.status === "suspended" ? (
                        <StatusIndicator tone="warning" label="Suspended" />
                      ) : null}
                      {removable ? (
                        <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(m)}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            {invitations.isPending ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : invitations.isError ? (
              <ErrorState
                message={friendlyMessage(invitations.error)}
                requestId={requestIdOf(invitations.error)}
                onRetry={() => void invitations.refetch()}
              />
            ) : invitations.data.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">No pending invitations.</p>
            ) : (
              <ul className="divide-border divide-y">
                {invitations.data.data.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex min-w-0 flex-col gap-2 py-3 min-[480px]:flex-row min-[480px]:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-anywhere text-sm font-medium">{inv.email}</p>
                      <p className="text-muted-foreground text-xs">
                        Invited by {inv.invitedBy.name}. Expires{" "}
                        {new Date(inv.expiresAt).toLocaleDateString()}.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{ROLE_LABELS[inv.role]}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(inv)}>
                        Revoke
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
        title="Revoke invitation?"
        description={
          revokeTarget
            ? `${revokeTarget.email} will no longer be able to join with this link.`
            : undefined
        }
        confirmLabel="Revoke"
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          if (revokeTarget) revoke.mutate(revokeTarget.id);
        }}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title="Remove member?"
        description={
          removeTarget
            ? `${removeTarget.name} will lose access to ${org.name} immediately.`
            : undefined
        }
        confirmLabel="Remove member"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (removeTarget) remove.mutate(removeTarget.userId);
        }}
      />
    </div>
  );
}
