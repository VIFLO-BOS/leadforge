"use client";

import type { Lead, PipelineConfig } from "@leadforge/contracts";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { useRef, useState, type Ref } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  cn,
  toast,
} from "@leadforge/ui";
import { activeStages, leadBusinessName, neighbourStage, stageLabel } from "@/lib/crm";
import { friendlyMessage } from "@/lib/errors";
import { StaleLeadError, useMoveLead, type MoveTarget } from "@/lib/hooks/use-pipeline";

/**
 * Stage moves with announcements. Every move is one version-checked request; a stale version is
 * read again and retried once when the lead is still where the user saw it. When someone else
 * moved it first, nothing is retried and the message says where it is now.
 */
export function useLeadMover(
  config: PipelineConfig | undefined,
  announce: (message: string) => void,
  /** The lead after the move, or where someone else moved it (focus can follow the card). */
  onMoved?: (lead: Lead) => void,
  /**
   * Optional follow-up after a move into Won or Lost: record the won value or the lost reason.
   * Offered in the toast (and by the card), never required: the move has already happened.
   */
  onFollowUp?: (lead: Lead, field: "wonValue" | "lostReason") => void,
) {
  const move = useMoveLead();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const run = (lead: Lead, target: MoveTarget) => {
    const name = leadBusinessName(lead);
    const to =
      "stageKey" in target
        ? target.stageKey
        : neighbourStage(config, lead.stageKey, target.direction)?.key;
    // One move per lead at a time; controls stay enabled (and focused) while it is in flight.
    if (!to || to === lead.stageKey || pendingRef.current === lead.id) return;
    pendingRef.current = lead.id;
    setPendingId(lead.id);
    announce(`Moving ${name} to ${stageLabel(config, to)}…`);
    move.mutate(
      { lead, target },
      {
        onSuccess: (res) => {
          const msg = `Moved ${name} to ${stageLabel(config, res.lead.stageKey)}.`;
          const closed = res.lead.stageKind !== "open" && lead.stageKind === "open";
          const field = res.lead.stageKind === "won" ? "wonValue" : "lostReason";
          const missing =
            field === "wonValue" ? res.lead.wonValueMinor === null : !res.lead.lostReason;
          const offer = closed && missing && Boolean(onFollowUp);
          const hint = offer
            ? ` You can record the ${field === "wonValue" ? "won value" : "lost reason"} from its card.`
            : "";
          announce(
            `${res.retried ? `${msg} It had changed since it loaded, so the latest version was used.` : msg}${hint}`,
          );
          onMoved?.(res.lead);
          if (offer && onFollowUp) {
            toast.success(msg, {
              description:
                field === "wonValue"
                  ? "Optional: record what the deal is worth."
                  : "Optional: record why it was lost.",
              action: {
                label: field === "wonValue" ? "Record won value" : "Record lost reason",
                onClick: () => onFollowUp(res.lead, field),
              },
            });
          }
        },
        onError: (err) => {
          if (err instanceof StaleLeadError) {
            const where = stageLabel(config, err.lead.stageKey);
            const msg = `${name} was moved to ${where} by someone else, so it was not moved again.`;
            announce(msg);
            toast.warning("This lead changed", {
              description: `${msg} The board shows the latest state.`,
            });
            onMoved?.(err.lead);
            return;
          }
          announce(`Could not move ${name}.`);
          toast.error(`Could not move ${name}`, { description: friendlyMessage(err) });
        },
        onSettled: () => {
          pendingRef.current = null;
          setPendingId(null);
        },
      },
    );
  };

  return { move: run, pendingId, isPending: move.isPending };
}

/** "Move to…" menu: every active stage, the current one checked. */
export function MoveToMenu({
  lead,
  config,
  onMove,
  disabled,
  size = "sm",
  compact,
  triggerRef,
}: {
  lead: Lead;
  config: PipelineConfig | undefined;
  onMove: (stageKey: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Icon-sized trigger with a visible "Move" label (cards). */
  compact?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const name = leadBusinessName(lead);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          size={size}
          disabled={disabled}
          aria-label={`Move to… ${name}, now in ${stageLabel(config, lead.stageKey)}`}
          className={cn(compact && "px-3")}
        >
          Move to… <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move {name} to</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={lead.stageKey}
          onValueChange={(key) => key !== lead.stageKey && onMove(key)}
        >
          {activeStages(config).map((s) => (
            <DropdownMenuRadioItem key={s.key} value={s.key}>
              {s.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Long stage names wrap inside the button instead of pushing it out of a narrow card. */
const WRAP = "h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left";

/** Previous and next stage buttons. Names include the destination, so screen readers know where. */
export function StageStepButtons({
  lead,
  config,
  onStep,
  disabled,
  labels = false,
}: {
  lead: Lead;
  config: PipelineConfig | undefined;
  onStep: (direction: "previous" | "next") => void;
  disabled?: boolean;
  /** Show the destination stage as text (detail panel) instead of icon-only buttons (cards). */
  labels?: boolean;
}) {
  const name = leadBusinessName(lead);
  const prev = neighbourStage(config, lead.stageKey, "previous");
  const next = neighbourStage(config, lead.stageKey, "next");
  return (
    <>
      <Button
        variant={labels ? "outline" : "ghost"}
        size={labels ? "sm" : "icon-sm"}
        className={labels ? WRAP : undefined}
        disabled={disabled || !prev}
        aria-label={
          labels
            ? undefined
            : prev
              ? `Move ${name} back to ${prev.label}`
              : `${name} is in the first stage`
        }
        data-move="previous"
        onClick={() => onStep("previous")}
      >
        <ArrowLeft aria-hidden />
        {labels ? (prev ? `Back to ${prev.label}` : "First stage") : null}
      </Button>
      <Button
        variant={labels ? "outline" : "ghost"}
        size={labels ? "sm" : "icon-sm"}
        className={labels ? WRAP : undefined}
        disabled={disabled || !next}
        aria-label={
          labels
            ? undefined
            : next
              ? `Move ${name} forward to ${next.label}`
              : `${name} is in the last stage`
        }
        data-move="next"
        onClick={() => onStep("next")}
      >
        {labels ? (next ? `Forward to ${next.label}` : "Last stage") : null}
        <ArrowRight aria-hidden />
      </Button>
    </>
  );
}
