import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { MeResponse, OrganizationRole } from "@leadforge/contracts";
import { TooltipProvider } from "@leadforge/ui";
import { vi } from "vitest";

/** Workspace value the mocked AppShell context returns. */
export function workspace(role: OrganizationRole = "owner") {
  const me: MeResponse = {
    user: {
      id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      email: "owner@example.test",
      name: "Ada Okafor (Sample)",
      emailVerifiedAt: "2026-10-01T08:00:00.000Z",
      createdAt: "2026-10-01T08:00:00.000Z",
    },
    organizations: [
      {
        id: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
        name: "Sample Logistics Ltd (Sample)",
        slug: "sample-logistics",
        country: "NG",
        role,
        deletionRequestedAt: null,
        purgeAfter: null,
      },
    ],
  };
  return { me, org: me.organizations[0]! };
}

export function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <TooltipProvider>{ui}</TooltipProvider>
      </QueryClientProvider>,
    ),
  };
}

export type Handler = (
  url: URL,
  init: RequestInit,
) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** Stubs global fetch with a router over the API paths; unmatched calls answer 404. */
export function stubApi(handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: (init.method ?? "GET").toUpperCase(), path: path + url.search, body });
    const res = handler(new URL(path + url.search, "http://localhost"), init) ?? {
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "Not found", requestId: "test" } },
    };
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { "content-type": "application/json", "x-request-id": "req-test", ...res.headers },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}
