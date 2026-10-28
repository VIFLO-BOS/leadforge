"use client";

import type { SessionSummary } from "@leadforge/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  toast,
} from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";

export function SecuritySettings() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<SessionSummary | null>(null);

  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: () => apiFetch<SessionSummary[]>("/auth/sessions", { noOrg: true }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/auth/sessions/${id}`, { method: "DELETE", noOrg: true }),
    onSuccess: () => {
      toast.success("Session signed out");
      void queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (err) => toast.error(friendlyMessage(err)),
    onSettled: () => setTarget(null),
  });

  return (
    <Card className="max-w-3xl">
      <div className="flex flex-col gap-1 p-5 pb-3 sm:p-6 sm:pb-3">
        <CardTitle className="leading-normal">Active sessions</CardTitle>
        <p className="text-muted-foreground text-sm">
          Devices currently signed in to your account. Sign out any you do not recognize.
        </p>
      </div>
      <div className="px-2 pb-3 sm:px-3">
        {sessions.isPending ? (
          <div className="flex flex-col gap-2 px-3 pb-2" aria-busy="true">
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
          </div>
        ) : sessions.isError ? (
          <div className="px-3 pb-2">
            <ErrorState
              message={friendlyMessage(sessions.error)}
              requestId={requestIdOf(sessions.error)}
              onRetry={() => void sessions.refetch()}
            />
          </div>
        ) : sessions.data.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Laptop}
            title="No sessions"
            description="You should at least see this one. Refresh to try again."
          />
        ) : (
          <ul className="flex flex-col">
            {sessions.data.map((s) => {
              const Icon = deviceIcon(s.userAgent);
              return (
                <li
                  key={s.id}
                  className="flex min-w-0 flex-col gap-3 rounded-md px-3 py-3 min-[480px]:flex-row min-[480px]:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="bg-surface-container-high text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="break-anywhere">
                          {s.userAgent ? summarizeUserAgent(s.userAgent) : "Unknown device"}
                        </span>
                        {s.current ? <Badge variant="primary">This device</Badge> : null}
                      </p>
                      <p className="break-anywhere text-muted-foreground text-xs">
                        {s.ip ? `${s.ip} · ` : ""}Last active{" "}
                        <time dateTime={s.lastUsedAt}>
                          {new Date(s.lastUsedAt).toLocaleString()}
                        </time>
                      </p>
                    </div>
                  </div>
                  {!s.current ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-13 self-start min-[480px]:ml-0 min-[480px]:self-center"
                      onClick={() => setTarget(s)}
                    >
                      Sign out
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Sign out this session?"
        description="The device will need to sign in again."
        confirmLabel="Sign out session"
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          if (target) revoke.mutate(target.id);
        }}
      />
    </Card>
  );
}

function deviceIcon(ua: string | null) {
  if (!ua) return Monitor;
  if (/Android|iPhone|iPad|Mobile/.test(ua)) return Smartphone;
  return Laptop;
}

function summarizeUserAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
