"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  CreateLeadRequest,
  Lead,
  PagedEnvelope,
  PipelineBoard,
  PipelineConfig,
  PipelineStage,
  UpdateLeadRequest,
  UpdatePipelineConfigRequest,
} from "@leadforge/contracts";
import { useMemo } from "react";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { isVersionConflict } from "../crm";
import { queryKeys } from "../query-keys";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

export const BOARD_PER_STAGE = 20;

export interface BoardFilters {
  assignedToUserId?: string;
  unassigned?: boolean;
  listId?: string;
}

export interface BoardColumn {
  stage: PipelineStage;
  /** Leads in the stage that match the filters (server count, adjusted after local moves). */
  count: number;
  leads: Lead[];
  /** Cursor of the first page the board did not load; null when the column is complete. */
  nextCursor: string | null;
}

/** Everything a lead change can affect: the board, columns, lead lookups, activity and reports. */
export function invalidatePipeline(queryClient: QueryClient, orgId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: ["org", orgId, "reports"] });
}

export function usePipelineConfig() {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.pipeline.config(org.id),
    queryFn: () => apiFetch<PipelineConfig>("/pipeline/config"),
    staleTime: 60_000,
    retry: retryServerErrors,
  });
}

function filterParams(filters: BoardFilters): Record<string, unknown> {
  return {
    assignedToUserId: filters.assignedToUserId,
    unassigned: filters.unassigned ? "true" : undefined,
    listId: filters.listId,
  };
}

/** Newest version of each lead wins, so a lead seen in two pages after a move shows once. */
function newest(a: Lead, b: Lead): Lead {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

/**
 * The pipeline board: one `GET /pipeline/board` (each active stage with its count and first
 * leads), filtered by owner, unassigned and, since Stage 8, the lead list (`listId`). Columns load
 * more with `useColumnMore` through `/pipeline/leads?stage=` with the same filters (`listId`
 * included). Leads are grouped by their own `stageKey`, so a lead that moved shows in its new
 * column at once.
 */
export function usePipelineBoard(filters: BoardFilters, extra: Record<string, Lead[]> = {}) {
  const { org } = useWorkspace();
  const params = filterParams(filters);

  const board = useQuery({
    queryKey: queryKeys.pipeline.board(org.id, params),
    queryFn: () =>
      apiFetch<PipelineBoard>(
        `/pipeline/board${toQueryString({ ...params, perStage: BOARD_PER_STAGE })}`,
      ),
    retry: retryServerErrors,
  });

  const boardData = board.data;
  const data = useMemo(() => {
    if (!boardData) return undefined;
    const all = new Map<string, Lead>();
    const order: string[] = [];
    const add = (l: Lead) => {
      const prev = all.get(l.id);
      if (!prev) order.push(l.id);
      all.set(l.id, prev ? newest(prev, l) : l);
    };
    for (const c of boardData.columns) c.leads.forEach(add);
    for (const leads of Object.values(extra)) leads.forEach(add);
    const columns: BoardColumn[] = boardData.columns.map((c) => ({
      stage: c.stage,
      count: c.count,
      nextCursor: c.nextCursor,
      leads: order.map((id) => all.get(id)!).filter((l) => l.stageKey === c.stage.key),
    }));
    return { config: boardData.config, columns };
  }, [boardData, extra]);

  return {
    data,
    isPending: board.isPending && !data,
    error: data ? null : board.error,
    refetch: () => void board.refetch(),
    isFetching: board.isFetching,
  };
}

/**
 * More leads for one column: `GET /pipeline/leads?stage=<key>&cursor=<nextCursor>` with the
 * board's filters, loaded only when asked for.
 */
export function useColumnMore(
  stage: string,
  filters: BoardFilters,
  startCursor: string | null,
  enabled: boolean,
) {
  const { org } = useWorkspace();
  const params = { ...filterParams(filters), start: startCursor };
  return useInfiniteQuery({
    queryKey: queryKeys.pipeline.column(org.id, stage, params),
    queryFn: ({ pageParam }) =>
      apiFetchPaged<Lead>(
        `/pipeline/leads${toQueryString({
          ...filterParams(filters),
          stage,
          sort: "updatedAt:desc",
          pageSize: BOARD_PER_STAGE,
          cursor: pageParam,
        })}`,
      ),
    initialPageParam: startCursor ?? undefined,
    getNextPageParam: (last: PagedEnvelope<Lead>) => last.meta.nextCursor ?? undefined,
    enabled: enabled && Boolean(startCursor),
    retry: retryServerErrors,
  });
}

/** The business's lead, or null when it is not in the pipeline (GET /pipeline/leads?businessId). */
export function useBusinessLead(businessId: string) {
  const { org } = useWorkspace();
  const q = { businessId, pageSize: 1 };
  return useQuery({
    queryKey: queryKeys.pipeline.leads(org.id, q),
    queryFn: async () =>
      (await apiFetchPaged<Lead>(`/pipeline/leads${toQueryString(q)}`)).data[0] ?? null,
    retry: retryServerErrors,
  });
}

/** Moves a lead between columns in every cached board, page and column (counts included). */
export function applyLeadChange(
  queryClient: QueryClient,
  orgId: string,
  before: Lead,
  after: Lead,
) {
  const moved = before.stageKey !== after.stageKey;
  queryClient.setQueriesData<PipelineBoard>(
    { queryKey: queryKeys.pipeline.boards(orgId) },
    (board) => {
      if (!board?.columns) return board;
      return {
        ...board,
        columns: board.columns.map((c) => {
          const without = c.leads.filter((l) => l.id !== after.id);
          let count = c.count;
          if (moved && c.stage.key === before.stageKey) count = Math.max(0, count - 1);
          if (moved && c.stage.key === after.stageKey) count += 1;
          const leads =
            c.stage.key === after.stageKey
              ? moved
                ? [after, ...without]
                : c.leads.map((l) => (l.id === after.id ? after : l))
              : without;
          return { ...c, count, leads };
        }),
      };
    },
  );
  for (const [key, page] of queryClient.getQueriesData<PagedEnvelope<Lead>>({
    queryKey: [...queryKeys.pipeline.all(orgId), "leads"],
  })) {
    if (!page?.data) continue;
    const params = (key[4] ?? {}) as { stage?: string };
    let data = page.data;
    let total = page.meta.total;
    if (params.stage && moved) {
      if (params.stage === before.stageKey) {
        data = data.filter((l) => l.id !== after.id);
        if (typeof total === "number") total = Math.max(0, total - 1);
      }
      if (params.stage === after.stageKey) {
        data = [after, ...data.filter((l) => l.id !== after.id)];
        if (typeof total === "number") total += 1;
      }
    } else {
      data = data.map((l) => (l.id === after.id ? after : l));
    }
    queryClient.setQueryData(key, { ...page, data, meta: { ...page.meta, total } });
  }
  queryClient.setQueriesData<InfiniteData<PagedEnvelope<Lead>>>(
    { queryKey: [...queryKeys.pipeline.all(orgId), "column"] },
    (inf) =>
      inf?.pages
        ? {
            ...inf,
            pages: inf.pages.map((p) => ({
              ...p,
              data: p.data.map((l) => (l.id === after.id ? after : l)),
            })),
          }
        : inf,
  );
}

export type MoveTarget = { direction: "next" | "previous" } | { stageKey: string };

/** The lead moved to another stage before this move landed, so it was not moved again. */
export class StaleLeadError extends Error {
  constructor(readonly lead: Lead) {
    super("The lead changed stage since this page loaded.");
    this.name = "StaleLeadError";
  }
}

/**
 * One version-checked stage move (POST /pipeline/leads/:id/move with `version`). On 409
 * VERSION_CONFLICT the lead is read again: if it is still in the stage the user saw (someone
 * changed something else), the move is retried once with the new version; if it moved, nothing
 * is retried and StaleLeadError carries the current lead so the screen can explain.
 */
export function useMoveLead() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lead,
      target,
      extra,
    }: {
      lead: Lead;
      target: MoveTarget;
      extra?: { lostReason?: string; wonValueMinor?: number; currency?: string };
    }): Promise<{ lead: Lead; retried: boolean }> => {
      const path = `/pipeline/leads/${encodeURIComponent(lead.id)}`;
      const send = (version: number) =>
        apiFetch<Lead>(`${path}/move`, { method: "POST", body: { ...target, ...extra, version } });
      try {
        return { lead: await send(lead.version), retried: false };
      } catch (err) {
        if (!isVersionConflict(err)) throw err;
        const fresh = await apiFetch<Lead>(path);
        if (fresh.stageKey !== lead.stageKey) throw new StaleLeadError(fresh);
        return { lead: await send(fresh.version), retried: true };
      }
    },
    onSuccess: (res, vars) => {
      applyLeadChange(queryClient, org.id, vars.lead, res.lead);
      invalidatePipeline(queryClient, org.id);
    },
    onError: (err, vars) => {
      if (err instanceof StaleLeadError) applyLeadChange(queryClient, org.id, vars.lead, err.lead);
      invalidatePipeline(queryClient, org.id);
    },
  });
}

/** POST /pipeline/leads/:id/assign with `version`; a stale version is read again and retried once. */
export function useAssignLead() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lead,
      assignedToUserId,
    }: {
      lead: Lead;
      assignedToUserId: string | null;
    }) => {
      const path = `/pipeline/leads/${encodeURIComponent(lead.id)}`;
      const send = (version: number) =>
        apiFetch<Lead>(`${path}/assign`, { method: "POST", body: { assignedToUserId, version } });
      try {
        return await send(lead.version);
      } catch (err) {
        if (!isVersionConflict(err)) throw err;
        const fresh = await apiFetch<Lead>(path);
        return await send(fresh.version);
      }
    },
    onSuccess: (lead, vars) => {
      applyLeadChange(queryClient, org.id, vars.lead, lead);
      invalidatePipeline(queryClient, org.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(org.id) });
    },
  });
}

/** POST /pipeline/leads: adds a business to the pipeline (200 with the existing lead if it has one). */
export function useCreateLead() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeadRequest) =>
      apiFetch<Lead>("/pipeline/leads", { method: "POST", body }),
    onSuccess: () => invalidatePipeline(queryClient, org.id),
  });
}

/**
 * PUT /pipeline/config with the loaded `version`. The new configuration replaces the cached one
 * and every board, column and lead query is refetched (stage names and order changed).
 */
export function useUpdatePipelineConfig() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePipelineConfigRequest) =>
      apiFetch<PipelineConfig>("/pipeline/config", { method: "PUT", body }),
    onSuccess: (config) => {
      queryClient.setQueryData(queryKeys.pipeline.config(org.id), config);
      invalidatePipeline(queryClient, org.id);
    },
    onError: (err) => {
      if (isVersionConflict(err))
        void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.config(org.id) });
    },
  });
}

/** The lead after someone else changed it first (409 VERSION_CONFLICT on an edit). */
export class LeadChangedError extends Error {
  constructor(readonly lead: Lead) {
    super("The lead changed since it was loaded.");
    this.name = "LeadChangedError";
  }
}

/**
 * PATCH /pipeline/leads/:id with `version`: priority, next action, lost reason, won value.
 * A stale version is not retried (the person's edit may no longer make sense): the lead is read
 * again, caches are patched, and LeadChangedError carries it so the form can explain and let the
 * person save again on the new version.
 */
export function useUpdateLead() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lead,
      body,
    }: {
      lead: Lead;
      body: Omit<UpdateLeadRequest, "version">;
    }) => {
      const path = `/pipeline/leads/${encodeURIComponent(lead.id)}`;
      try {
        return await apiFetch<Lead>(path, {
          method: "PATCH",
          body: { ...body, version: lead.version },
        });
      } catch (err) {
        if (!isVersionConflict(err)) throw err;
        throw new LeadChangedError(await apiFetch<Lead>(path));
      }
    },
    onSuccess: (updated, vars) => {
      applyLeadChange(queryClient, org.id, vars.lead, updated);
      invalidatePipeline(queryClient, org.id);
    },
    onError: (err, vars) => {
      if (err instanceof LeadChangedError)
        applyLeadChange(queryClient, org.id, vars.lead, err.lead);
    },
  });
}
