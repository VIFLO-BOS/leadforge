"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UpdateOrganizationRequest, type OrganizationProfile } from "@leadforge/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Code,
  ErrorState,
  FormField,
  Input,
  Skeleton,
  toast,
} from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { useWorkspace } from "../app-shell";

type Values = UpdateOrganizationRequest;

export function OrganizationSettings({ canEdit }: { canEdit: boolean }) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: ["org", org.id, "profile"],
    queryFn: () => apiFetch<OrganizationProfile>("/organizations/current"),
  });

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
      void queryClient.invalidateQueries({ queryKey: ["org", org.id, "profile"] });
      void queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err) => toast.error(friendlyMessage(err)),
  });

  if (profile.isPending) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </CardContent>
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
    <Card>
      <CardHeader>
        <CardTitle>Organization profile</CardTitle>
        <CardDescription>
          {canEdit
            ? "Changes apply to everyone in the workspace."
            : "Only the organization owner can change these settings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((v) => update.mutate(v))}
          noValidate
          className="flex max-w-lg flex-col gap-4"
        >
          <FormField id="org-name" label="Name" required error={errors.name?.message}>
            <Input
              id="org-name"
              disabled={!canEdit}
              invalid={Boolean(errors.name)}
              {...form.register("name")}
            />
          </FormField>
          <div className="xs:grid-cols-2 grid grid-cols-1 gap-4">
            <FormField
              id="org-country"
              label="Country"
              required
              hint="Two-letter code"
              error={errors.country?.message}
            >
              <Input
                id="org-country"
                maxLength={2}
                className="uppercase"
                disabled={!canEdit}
                {...form.register("country")}
              />
            </FormField>
            <FormField
              id="org-currency"
              label="Currency"
              required
              hint="Three-letter code"
              error={errors.defaultCurrency?.message}
            >
              <Input
                id="org-currency"
                maxLength={3}
                className="uppercase"
                disabled={!canEdit}
                {...form.register("defaultCurrency")}
              />
            </FormField>
          </div>
          <FormField
            id="org-freshness"
            label="Freshness window (days)"
            required
            hint="Contact fields older than this are marked stale."
            error={errors.freshnessDays?.message}
          >
            <Input
              id="org-freshness"
              type="number"
              inputMode="numeric"
              min={7}
              max={730}
              disabled={!canEdit}
              {...form.register("freshnessDays", { valueAsNumber: true })}
            />
          </FormField>
          <p className="text-muted-foreground text-xs">
            Organization ID <Code>{profile.data.id}</Code>
          </p>
          {canEdit ? (
            <div>
              <Button type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
