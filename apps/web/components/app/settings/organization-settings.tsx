"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UpdateOrganizationRequest, type OrganizationProfile } from "@leadforge/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Card,
  CardTitle,
  CopyableValue,
  ErrorState,
  Skeleton,
  TextField,
  toast,
} from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { useOrgProfile } from "@/lib/hooks/use-org-lifecycle";
import { queryKeys } from "@/lib/query-keys";
import { useWorkspace } from "../app-shell";
import { DataAndDeletionSection } from "./data-and-deletion";

type Values = UpdateOrganizationRequest;

export function OrganizationSettings({
  canEdit,
  navigate,
}: {
  canEdit: boolean;
  /** Where the browser goes for an organization export download (tests pass a spy). */
  navigate?: (url: string) => void;
}) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const profile = useOrgProfile();

  const form = useForm<Values>({
    resolver: zodResolver(UpdateOrganizationRequest),
    defaultValues: { name: "", country: "NG", defaultCurrency: "NGN", freshnessDays: 180 },
  });

  useEffect(() => {
    if (profile.data) {
      form.reset({
        name: profile.data.name,
        country: profile.data.country,
        defaultCurrency: profile.data.defaultCurrency,
        freshnessDays: profile.data.freshnessDays,
      });
    }
  }, [profile.data, form]);

  const update = useMutation({
    mutationFn: (values: Values) =>
      apiFetch<OrganizationProfile>("/organizations/current", { method: "PATCH", body: values }),
    onSuccess: () => {
      toast.success("Organization updated");
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgProfile(org.id) });
      void queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err) => toast.error(friendlyMessage(err)),
  });

  if (profile.isPending) {
    return (
      <Card className="flex max-w-3xl flex-col gap-5 p-5 sm:p-6" aria-busy="true">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </Card>
    );
  }

  if (profile.isError) {
    return (
      <ErrorState
        message={friendlyMessage(profile.error)}
        requestId={requestIdOf(profile.error)}
        onRetry={() => void profile.refetch()}
      />
    );
  }

  const { errors } = form.formState;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card className="max-w-3xl">
        <div className="flex flex-col gap-1 p-5 pb-2 sm:p-6 sm:pb-2">
          <CardTitle className="leading-normal">Organization profile</CardTitle>
          <p className="text-muted-foreground text-sm">
            {canEdit
              ? "Changes apply to everyone in the workspace."
              : "Only the organization owner can change these settings."}
          </p>
        </div>
        <form
          onSubmit={form.handleSubmit((v) => update.mutate(v))}
          noValidate
          className="flex flex-col gap-5 p-5 pt-4 sm:p-6 sm:pt-4"
        >
          <TextField
            id="org-name"
            label="Organization name"
            required
            disabled={!canEdit}
            error={errors.name?.message}
            {...form.register("name")}
          />
          <div className="xs:grid-cols-2 grid grid-cols-1 gap-5">
            <TextField
              id="org-country"
              label="Country"
              required
              maxLength={2}
              className="uppercase"
              hint="Two-letter code, for example NG"
              disabled={!canEdit}
              error={errors.country?.message}
              {...form.register("country")}
            />
            <TextField
              id="org-currency"
              label="Currency"
              required
              maxLength={3}
              className="uppercase"
              hint="Three-letter code, for example NGN"
              disabled={!canEdit}
              error={errors.defaultCurrency?.message}
              {...form.register("defaultCurrency")}
            />
          </div>
          <TextField
            id="org-freshness"
            label="Freshness window (days)"
            type="number"
            inputMode="numeric"
            min={7}
            max={730}
            required
            hint="Contact fields older than this are marked stale."
            disabled={!canEdit}
            error={errors.freshnessDays?.message}
            {...form.register("freshnessDays", { valueAsNumber: true })}
          />
          <div className="bg-surface-container-low flex min-w-0 flex-col gap-0.5 rounded-md px-4 py-3">
            <span className="text-muted-foreground text-xs font-medium">Organization ID</span>
            <CopyableValue value={profile.data.id} label="organization ID" />
          </div>
          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </Card>
      <DataAndDeletionSection profile={profile.data} navigate={navigate} />
    </div>
  );
}
