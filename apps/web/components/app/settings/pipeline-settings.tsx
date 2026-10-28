"use client";

import type { PipelineConfig } from "@leadforge/contracts";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ErrorState,
  LiveAnnouncement,
  Skeleton,
  TextField,
  cn,
  toast,
} from "@leadforge/ui";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { isVersionConflict } from "@/lib/crm";
import { usePipelineConfig, useUpdatePipelineConfig } from "@/lib/hooks/use-pipeline";
import {
  STAGE_LIMITS,
  activeCount,
  addStage,
  archiveStage,
  canAddStage,
  draftFromConfig,
  entryStageId,
  hasProblems,
  isDirty,
  isFixed,
  moveStage,
  moveTarget,
  renameStage,
  restoreStage,
  serverRowErrors,
  stageNotEmptyDetails,
  toRequest,
  validateDraft,
  type StageDraft,
} from "@/lib/pipeline-config";

type Control = "up" | "down" | "archive" | "label";

/**
 * Settings → Pipeline stages (owners and administrators; `settings:pipeline`). Rename, add,
 * archive and restore stages and change their order with Move up and Move down (no drag). Won
 * and Lost close a lead and stay fixed at the end. Saved in one PUT with the loaded version: a
 * 409 VERSION_CONFLICT reloads the stages and explains; 409 STAGE_NOT_EMPTY names the stage that
 * still holds leads. Other roles see the stages read only.
 */
export function PipelineSettings({ canEdit }: { canEdit: boolean }) {
  const config = usePipelineConfig();
  if (config.isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading pipeline stages"
        className="flex flex-col gap-3"
      >
        <Skeleton className="h-8 w-64 max-w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-md" />
        ))}
      </div>
    );
  }
  if (config.isError && !config.data) {
    return (
      <ErrorState
        title={
          isForbidden(config.error)
            ? "Your role cannot view the pipeline"
            : "Could not load the pipeline stages"
        }
        message={friendlyMessage(config.error)}
        requestId={requestIdOf(config.error)}
        onRetry={isForbidden(config.error) ? undefined : () => void config.refetch()}
      />
    );
  }
  return <StageEditor config={config.data!} canEdit={canEdit} onReload={() => config.refetch()} />;
}

function StageEditor({
  config,
  canEdit,
  onReload,
}: {
  config: PipelineConfig;
  canEdit: boolean;
  onReload: () => Promise<unknown>;
}) {
  const save = useUpdatePipelineConfig();
  const [draft, setDraft] = useState<StageDraft[]>(() => draftFromConfig(config));
  const [base, setBase] = useState<PipelineConfig>(config);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<{
    tone: "warning" | "info";
    title: string;
    body: React.ReactNode;
  } | null>(null);
  const focusReq = useRef<{ id: string; control: Control } | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const noticeRef = useRef<HTMLDivElement>(null);

  // A newer configuration from the server (after a save or a reload) replaces an unchanged draft.
  useEffect(() => {
    if (config.version !== base.version && !isDirty(draft, base)) {
      setDraft(draftFromConfig(config));
      setBase(config);
    }
  }, [config, base, draft]);

  useEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    focusReq.current = null;
    const el = refs.current.get(`${req.id}:${req.control}`);
    const fallback = refs.current.get(`${req.id}:${req.control === "up" ? "down" : "up"}`);
    const target =
      el && !(el as HTMLButtonElement).disabled
        ? el
        : fallback && !(fallback as HTMLButtonElement).disabled
          ? fallback
          : refs.current.get(`${req.id}:label`);
    target?.focus();
  });

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const local = validateDraft(draft);
  const server = serverRowErrors(save.error, draft);
  const rowError = (id: string) =>
    (submitted || draft.find((s) => s.id === id)?.isNew === false ? local.rows[id] : undefined) ??
    server.rows[id];
  const formError = local.form ?? server.form;
  const dirty = isDirty(draft, base);
  const active = activeCount(draft);
  const entryId = entryStageId(draft);
  const positionOf = useMemo(() => new Map(draft.map((s, i) => [s.id, i + 1])), [draft]);

  const setRef = (key: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };

  const move = (s: StageDraft, direction: "up" | "down") => {
    if (moveTarget(draft, s.id, direction) === null) return;
    const next = moveStage(draft, s.id, direction);
    setDraft(next);
    focusReq.current = { id: s.id, control: direction };
    const pos = next.findIndex((x) => x.id === s.id) + 1;
    setMessage(
      `Moved ${s.label.trim() || "the new stage"} ${direction} to position ${pos} of ${next.length}.`,
    );
  };

  const archive = (s: StageDraft) => {
    const next = archiveStage(draft, s.id);
    setDraft(next);
    if (s.isNew) {
      setMessage(`Removed the new stage ${s.label.trim() || ""}.`.replace(" .", "."));
      const after =
        next[
          Math.min(
            draft.findIndex((x) => x.id === s.id),
            next.length - 1,
          )
        ];
      if (after) focusReq.current = { id: after.id, control: "label" };
      return;
    }
    focusReq.current = { id: s.id, control: "archive" };
    setMessage(`${s.label} will be archived when you save. Its leads must be moved first.`);
  };

  const restore = (s: StageDraft) => {
    setDraft(restoreStage(draft, s.id));
    focusReq.current = { id: s.id, control: "archive" };
    setMessage(`${s.label} will be restored when you save.`);
  };

  const add = () => {
    const { draft: next, id } = addStage(draft);
    setDraft(next);
    focusReq.current = { id, control: "label" };
    setMessage("Added a new stage before Won and Lost. Name it, then save.");
  };

  const discard = () => {
    setDraft(draftFromConfig(base));
    setSubmitted(false);
    save.reset();
    setNotice(null);
    setMessage("Changes discarded.");
  };

  const reloadAfterConflict = async () => {
    const res = (await onReload()) as { data?: PipelineConfig } | undefined;
    const latest = res?.data ?? config;
    setDraft(draftFromConfig(latest));
    setBase(latest);
    setSubmitted(false);
  };

  const submit = () => {
    setSubmitted(true);
    setNotice(null);
    if (hasProblems(local)) {
      const first = draft.find((s) => local.rows[s.id]);
      if (first) refs.current.get(`${first.id}:label`)?.focus();
      setMessage(local.form ?? "Some stages need a change before saving.");
      return;
    }
    save.mutate(toRequest(draft, base.version), {
      onSuccess: (saved) => {
        setBase(saved);
        setDraft(draftFromConfig(saved));
        setSubmitted(false);
        setMessage("Pipeline stages saved.");
        toast.success("Pipeline stages saved", {
          description: "The board and every lead use the new stages now.",
        });
      },
      onError: (err) => {
        if (isVersionConflict(err)) {
          void reloadAfterConflict();
          setNotice({
            tone: "warning",
            title: "Someone else changed the stages",
            body: "Their version was saved first, so yours was not. The latest stages are loaded below; make your changes again and save.",
          });
          setMessage(
            "Someone else changed the stages first. The latest stages were loaded; your changes were not saved.",
          );
          return;
        }
        const notEmpty = stageNotEmptyDetails(err);
        if (notEmpty) {
          const stage = draft.find((s) => s.key === notEmpty.stageKey);
          const name = stage?.label ?? notEmpty.stageKey ?? "A stage";
          setNotice({
            tone: "warning",
            title: `${name} still holds leads`,
            body: (
              <>
                {name} has{" "}
                {notEmpty.leads !== null
                  ? `${notEmpty.leads} ${notEmpty.leads === 1 ? "lead" : "leads"}`
                  : "leads"}
                , and a stage with leads cannot be archived (they would disappear from the board).
                Move them to another stage on the{" "}
                <Link
                  className="link-inline"
                  href={`/app/pipeline${notEmpty.stageKey ? `?stage=${encodeURIComponent(notEmpty.stageKey)}` : ""}`}
                >
                  pipeline
                </Link>
                , then archive it. Nothing was saved.
              </>
            ),
          });
          setMessage(`${name} still holds leads, so nothing was saved.`);
          return;
        }
        setMessage("The stages were not saved.");
      },
    });
  };

  const generic =
    save.isError &&
    !isVersionConflict(save.error) &&
    !stageNotEmptyDetails(save.error) &&
    !Object.keys(server.rows).length &&
    !server.form
      ? save.error
      : null;

  return (
    <Card data-testid="pipeline-settings">
      <CardHeader>
        <CardTitle>Pipeline stages</CardTitle>
        <CardDescription>
          The stages of the lead pipeline, in board order. New leads start in the first active
          stage. Won and Lost close a lead and always stay at the end. At most{" "}
          {STAGE_LIMITS.activeMax} stages can be active.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <LiveAnnouncement message={message} data-testid="stages-announcer" />
        {notice ? (
          <div
            ref={noticeRef}
            tabIndex={-1}
            className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2"
          >
            <Banner
              tone={notice.tone}
              title={notice.title}
              description={notice.body}
              data-testid="stages-notice"
            />
          </div>
        ) : null}
        {!canEdit ? (
          <p className="text-muted-foreground text-sm">
            Owners and administrators can rename, add, archive and reorder stages.
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs" aria-live="polite" data-testid="active-count">
          {active} of {STAGE_LIMITS.activeMax} active stages · {draft.length} of{" "}
          {STAGE_LIMITS.totalMax} in all
        </p>
        <ol className="flex min-w-0 flex-col gap-2" aria-label="Stages in board order">
          {draft.map((s) => {
            const pos = positionOf.get(s.id) ?? 0;
            const name = s.label.trim() || "New stage";
            const err = canEdit ? rowError(s.id) : undefined;
            const up = moveTarget(draft, s.id, "up") !== null;
            const down = moveTarget(draft, s.id, "down") !== null;
            return (
              <li
                key={s.id}
                data-stage-id={s.id}
                className={cn(
                  "border-border bg-surface transition-ui flex min-w-0 flex-col gap-3 rounded-md border p-3 min-[640px]:flex-row min-[640px]:items-start",
                  s.archived && "bg-surface-container-low",
                )}
              >
                <span
                  className="text-muted-foreground w-6 shrink-0 pt-1 text-sm tabular-nums min-[640px]:pt-3.5"
                  aria-hidden
                >
                  {pos}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {canEdit ? (
                    <TextField
                      id={`stage-${s.id}`}
                      label={`Stage ${pos} name`}
                      value={s.label}
                      maxLength={STAGE_LIMITS.labelMax + 10}
                      onChange={(e) => setDraft(renameStage(draft, s.id, e.target.value))}
                      error={err}
                      ref={setRef(`${s.id}:label`)}
                      disabled={s.archived}
                    />
                  ) : (
                    <p className="pt-1 text-sm font-medium">{s.label}</p>
                  )}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {s.kind === "won" ? <Badge variant="success">Closes as won</Badge> : null}
                    {s.kind === "lost" ? <Badge variant="neutral">Closes as lost</Badge> : null}
                    {s.id === entryId ? (
                      <Badge variant="primary">New leads start here</Badge>
                    ) : null}
                    {s.archived ? <Badge variant="outline">Archived</Badge> : null}
                    {s.isNew ? <Badge variant="outline">New, not saved</Badge> : null}
                    {s.key && !s.isNew ? (
                      <span className="text-muted-foreground font-mono text-[11px]">{s.key}</span>
                    ) : null}
                  </div>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-1 min-[640px]:pt-1.5">
                    {isFixed(s) ? (
                      <span className="text-muted-foreground px-2 text-xs">Fixed position</span>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!up}
                          ref={setRef(`${s.id}:up`) as React.Ref<HTMLButtonElement>}
                          aria-label={`Move ${name} up`}
                          onClick={() => move(s, "up")}
                        >
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!down}
                          ref={setRef(`${s.id}:down`) as React.Ref<HTMLButtonElement>}
                          aria-label={`Move ${name} down`}
                          onClick={() => move(s, "down")}
                        >
                          <ArrowDown aria-hidden />
                        </Button>
                        {s.archived ? (
                          <Button
                            variant="text"
                            size="sm"
                            ref={setRef(`${s.id}:archive`) as React.Ref<HTMLButtonElement>}
                            disabled={active >= STAGE_LIMITS.activeMax}
                            aria-label={`Restore ${name}`}
                            onClick={() => restore(s)}
                          >
                            <ArchiveRestore aria-hidden /> Restore
                          </Button>
                        ) : (
                          <Button
                            variant="text"
                            size="sm"
                            ref={setRef(`${s.id}:archive`) as React.Ref<HTMLButtonElement>}
                            aria-label={s.isNew ? `Remove ${name}` : `Archive ${name}`}
                            onClick={() => archive(s)}
                          >
                            {s.isNew ? <Trash2 aria-hidden /> : <Archive aria-hidden />}
                            {s.isNew ? "Remove" : "Archive"}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        {canEdit && formError && (submitted || local.form) ? (
          <p role="alert" className="text-destructive text-sm" data-testid="stages-form-error">
            {formError}
          </p>
        ) : null}
        {generic ? (
          <ErrorState
            title="Could not save the stages"
            message={friendlyMessage(generic)}
            requestId={requestIdOf(generic)}
          />
        ) : null}
        <p className="text-muted-foreground text-xs">
          Archived stages leave the board but keep their history and reports. A stage that still
          holds leads cannot be archived. Last changed {formatDateTime(base.updatedAt)}.
        </p>
      </CardContent>
      {canEdit ? (
        <CardFooter className="justify-between">
          <Button variant="outline" onClick={add} disabled={!canAddStage(draft)}>
            <Plus aria-hidden /> Add stage
          </Button>
          <span className="flex flex-wrap gap-2">
            <Button variant="text" onClick={discard} disabled={!dirty || save.isPending}>
              <RotateCcw aria-hidden /> Discard changes
            </Button>
            <Button onClick={submit} loading={save.isPending} disabled={!dirty}>
              Save stages
            </Button>
          </span>
        </CardFooter>
      ) : null}
    </Card>
  );
}
