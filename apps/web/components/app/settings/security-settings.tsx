"use client";

import type { SessionSummary } from "@leadforge/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
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
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Devices currently signed in to your account. Sign out any you do not recognize.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : sessions.isError ? (
          <ErrorState
            message={friendlyMessage(sessions.error)}
            requestId={requestIdOf(sessions.error)}
            onRetry={() => void sessions.refetch()}
          />
        ) : sessions.data.length === 0 ? (
          <EmptyState
            icon={Laptop}
            title="No sessions"
            description="You should at least see this one. Refresh to try again."
          />
        ) : (
          <ul className="divide-border divide-y">
            {sessions.data.map((s) => (
              <li
                key={s.id}
                className="flex min-w-0 flex-col gap-2 py-3 min-[480px]:flex-row min-[480px]:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="break-anywhere">
                      {s.userAgent ? summarizeUserAgent(s.userAgent) : "Unknown device"}
                    </span>
                    {s.current ? <Badge variant="primary">This device</Badge> : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {s.ip ? `${s.ip} · ` : ""}Last active {new Date(s.lastUsedAt).toLocaleString()}
                  </p>
                </div>
                {!s.current ? (
                  <Button variant="outline" size="sm" onClick={() => setTarget(s)}>
                    Sign out
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
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
