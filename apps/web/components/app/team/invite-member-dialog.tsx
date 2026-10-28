"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreateInvitationRequest, ROLE_LABELS, type OrganizationRole } from "@leadforge/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
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
  DialogTrigger,
  ErrorState,
  FormField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextField,
  toast,
} from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, memberLimitDetails, memberLimitMessage, requestIdOf } from "@/lib/errors";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { isPendingDeletion } from "@/lib/org-lifecycle";
import { PendingDeletionNotice } from "../pending-deletion-notice";

const INVITABLE_ROLES: Exclude<OrganizationRole, "owner">[] = [
  "admin",
  "researcher",
  "sales_rep",
  "analyst",
];

export function InviteMemberDialog({ organizationId }: { organizationId: string }) {
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm<CreateInvitationRequest>({
    resolver: zodResolver(CreateInvitationRequest),
    defaultValues: { email: "", role: "researcher" },
  });

  const invite = useMutation({
    mutationFn: (values: CreateInvitationRequest) =>
      apiFetch("/organizations/current/invitations", { method: "POST", body: values }),
    onSuccess: (_d, values) => {
      toast.success(`Invitation sent to ${values.email}`);
      void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "invitations"] });
      form.reset();
      setOpen(false);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === "CONFLICT") {
        form.setError("email", {
          message: "This person is already a member or already has a pending invitation.",
        });
      }
      if (isApiError(err) && err.code === "MEMBER_LIMIT_REACHED") {
        // Pending invitations count toward the cap: refresh the list the dialog sits on.
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "invitations"] });
      }
    },
  });

  const { errors } = form.formState;
  const limitReached = isApiError(invite.error) && invite.error.code === "MEMBER_LIMIT_REACHED";
  const limit = memberLimitDetails(invite.error);
  const genericError =
    invite.isError &&
    !(
      isApiError(invite.error) &&
      (invite.error.code === "CONFLICT" || invite.error.code === "MEMBER_LIMIT_REACHED")
    ) &&
    !isPendingDeletion(invite.error)
      ? invite.error
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          form.reset();
          invite.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={form.handleSubmit((v) => invite.mutate(v))}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              They receive an email with a link that expires in 7 days.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
            <TextField
              id="inv-email"
              label="Email"
              type="email"
              required
              autoComplete="off"
              inputMode="email"
              error={errors.email?.message}
              {...form.register("email")}
            />
            <FormField id="inv-role" label="Role" required error={errors.role?.message}>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="inv-role" aria-label="Role" className="h-12">
                      <SelectValue placeholder="Choose a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {INVITABLE_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            {limitReached ? (
              <Banner
                tone="warning"
                title={
                  limit ? `Member limit reached: ${limit.cap} on this plan` : "Member limit reached"
                }
                data-testid="member-limit"
                description={limit ? memberLimitMessage(limit) : friendlyMessage(invite.error)}
                actions={
                  can("billing:manage") ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href="/app/billing?tab=plans">
                        <CreditCard aria-hidden /> See plans
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            <PendingDeletionNotice error={invite.error} outcome="No invitation was sent." />
            {genericError ? (
              <ErrorState
                title="Could not send invitation"
                message={friendlyMessage(genericError)}
                requestId={requestIdOf(genericError)}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="text" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={invite.isPending}>
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
