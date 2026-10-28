"use client";

import {
  ROLE_LABELS,
  roleHasPermission,
  type InvitationSummary,
  type MemberSummary,
} from "@leadforge/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MailPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Heading,
  HeadingLevel,
  initials,
  PageHeader,
  StatusIndicator,
  toast,
} from "@leadforge/ui";
import { apiFetch, apiFetchPaged } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { useWorkspace } from "../app-shell";
import { InviteMemberDialog } from "./invite-member-dialog";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function TeamPage() {
  const { org, me } = useWorkspace();
  const queryClient = useQueryClient();
  const canManage = roleHasPermission(org.role, "members:manage");
  const canManageOwners = roleHasPermission(org.role, "members:manage_owners");
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

  const memberColumns = useMemo<ColumnDef<MemberSummary>[]>(
    () => [
      {
        id: "member",
        header: "Member",
        meta: { label: "Member", mobileTitle: true },
        enableHiding: false,
        cell: ({ row }) => {
          const m = row.original;
          const isSelf = m.userId === me.user.id;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar>
                <AvatarFallback>{initials(m.name)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="break-anywhere font-medium">
                  {m.name}
                  {isSelf ? (
                    <span className="text-muted-foreground font-normal"> (you)</span>
                  ) : null}
                </span>
                <span className="break-anywhere text-muted-foreground text-xs">{m.email}</span>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: "Role",
        meta: { label: "Role" },
        cell: ({ row }) => (
          <Badge variant={row.original.role === "owner" ? "primary" : "neutral"}>
            {ROLE_LABELS[row.original.role]}
          </Badge>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) =>
          row.original.status === "suspended" ? (
            <StatusIndicator tone="warning" label="Suspended" />
          ) : (
            <StatusIndicator tone="success" label="Active" />
          ),
      },
      {
        id: "joined",
        header: "Joined",
        meta: { label: "Joined" },
        cell: ({ row }) => (
          <time
            dateTime={row.original.joinedAt}
            className="text-muted-foreground whitespace-nowrap"
          >
            {dateFormat.format(new Date(row.original.joinedAt))}
          </time>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: "Actions", align: "end", mobileActions: true },
        enableHiding: false,
        cell: ({ row }) => {
          const m = row.original;
          const removable =
            canManage && m.userId !== me.user.id && (m.role !== "owner" || canManageOwners);
          return removable ? (
            <Button
              variant="text"
              size="sm"
              onClick={() => setRemoveTarget(m)}
              aria-label={`Remove ${m.name}`}
            >
              Remove
            </Button>
          ) : null;
        },
      },
    ],
    [canManage, canManageOwners, me.user.id],
  );

  const invitationColumns = useMemo<ColumnDef<InvitationSummary>[]>(
    () => [
      {
        id: "email",
        header: "Email",
        meta: { label: "Email", mobileTitle: true },
        enableHiding: false,
        cell: ({ row }) => <span className="break-anywhere font-medium">{row.original.email}</span>,
      },
      {
        id: "role",
        header: "Role",
        meta: { label: "Role" },
        cell: ({ row }) => <Badge>{ROLE_LABELS[row.original.role]}</Badge>,
      },
      {
        id: "invitedBy",
        header: "Invited by",
        meta: { label: "Invited by" },
        cell: ({ row }) => <span className="break-anywhere">{row.original.invitedBy.name}</span>,
      },
      {
        id: "expires",
        header: "Expires",
        meta: { label: "Expires" },
        cell: ({ row }) => (
          <time
            dateTime={row.original.expiresAt}
            className="text-muted-foreground whitespace-nowrap"
          >
            {dateFormat.format(new Date(row.original.expiresAt))}
          </time>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: "Actions", align: "end", mobileActions: true },
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            variant="text"
            size="sm"
            onClick={() => setRevokeTarget(row.original)}
            aria-label={`Revoke invitation for ${row.original.email}`}
          >
            Revoke
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Account"
        title="Team Members"
        description={`People with access to ${org.name} and the role each one holds.`}
        actions={canManage ? <InviteMemberDialog organizationId={org.id} /> : null}
      />

      <section aria-labelledby="members-title" className="flex flex-col gap-3">
        <Heading id="members-title" className="text-base font-medium">
          Members
          {members.data ? (
            <span className="text-muted-foreground font-normal"> ({members.data.data.length})</span>
          ) : null}
        </Heading>
        <HeadingLevel>
          <DataTable
            caption="Members"
            columns={memberColumns}
            data={members.data?.data ?? []}
            getRowId={(m) => m.userId}
            loading={members.isPending}
            skeletonRows={3}
            mobileCards
            enableDensityToggle={false}
            enableColumnVisibility={false}
            error={
              members.isError ? (
                <ErrorState
                  message={friendlyMessage(members.error)}
                  requestId={requestIdOf(members.error)}
                  onRetry={() => void members.refetch()}
                />
              ) : undefined
            }
            empty={
              <EmptyState
                size="compact"
                icon={Users}
                title="No members found"
                description="This is unexpected. Refresh to try again."
              />
            }
          />
        </HeadingLevel>
      </section>

      {canManage ? (
        <section aria-labelledby="invitations-title" className="flex flex-col gap-3">
          <Heading id="invitations-title" className="text-base font-medium">
            Pending invitations
          </Heading>
          <HeadingLevel>
            <DataTable
              caption="Pending invitations"
              columns={invitationColumns}
              data={invitations.data?.data ?? []}
              getRowId={(inv) => inv.id}
              loading={invitations.isPending}
              skeletonRows={2}
              mobileCards
              enableDensityToggle={false}
              enableColumnVisibility={false}
              error={
                invitations.isError ? (
                  <ErrorState
                    message={friendlyMessage(invitations.error)}
                    requestId={requestIdOf(invitations.error)}
                    onRetry={() => void invitations.refetch()}
                  />
                ) : undefined
              }
              empty={
                <EmptyState
                  size="compact"
                  icon={MailPlus}
                  title="No pending invitations"
                  description="Invitations you send appear here until they are accepted, revoked or expire after 7 days."
                />
              }
            />
          </HeadingLevel>
        </section>
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
