"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreateInvitationRequest, ROLE_LABELS, type OrganizationRole } from "@leadforge/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@leadforge/ui";
import { apiFetch, isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";

const INVITABLE_ROLES: Exclude<OrganizationRole, "owner">[] = [
  "admin",
  "researcher",
  "sales_rep",
  "analyst",
];

export function InviteMemberDialog({ organizationId }: { organizationId: string }) {
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
    },
  });

  const { errors } = form.formState;
  const genericError =
    invite.isError && !(isApiError(invite.error) && invite.error.code === "CONFLICT")
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
          <DialogBody className="flex flex-col gap-4">
            <FormField id="inv-email" label="Email" required error={errors.email?.message}>
              <Input
                id="inv-email"
                type="email"
                autoComplete="off"
                inputMode="email"
                invalid={Boolean(errors.email)}
                {...form.register("email")}
              />
            </FormField>
            <FormField id="inv-role" label="Role" required error={errors.role?.message}>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="inv-role" aria-label="Role">
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
            {genericError ? (
              <ErrorState
                title="Could not send invitation"
                message={friendlyMessage(genericError)}
                requestId={requestIdOf(genericError)}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
