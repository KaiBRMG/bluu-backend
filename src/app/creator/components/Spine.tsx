"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { COLOR, DONE_HEX, SPINE, URGENCY, type Urgency } from "../theme";

/**
 * The spine — the creator portal's signature structure.
 *
 * It is a **time axis**, not decoration and not a card border. Work is pinned to
 * it in the order it comes due: overdue above, today lit in azure, then one
 * graduation per day running down the screen. Everything the portal knows about
 * urgency is expressed as a position on this line, which is why the dashboard
 * can answer "am I behind?" without the creator reading a single number.
 *
 * ── The rule that governs every mark here ────────────────────────────────────
 * On this palette `azure` against `ink2` measures **1.14:1**. Hue therefore
 * cannot distinguish two states on its own. Every node below is a **shape and a
 * hue**: overdue is filled with a halo, today is filled, upcoming is a hollow
 * ring, undated is a hollow ring at half size, done is filled with a tick. Take
 * the colour away and the axis still reads. Do not "simplify" a node to a
 * colour swap.
 */

// The rule sits at the centre of the rail column; the half-pixel keeps a 1px
// line optically centred on the nodes rather than a hair to their right.
const RULE_LEFT = `calc(${SPINE.centre} - 0.5px)`;

/** The vertical rule for one group, coloured by that group's bucket. */
function Rule({ bucket, from = "0" }: { bucket: Urgency; from?: string }) {
  const lit = bucket === "late" || bucket === "today";
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-0 w-px"
      style={{
        left: RULE_LEFT,
        top: from,
        background: lit
          ? `linear-gradient(to bottom, ${URGENCY[bucket].hex}, ${URGENCY[bucket].hex}55)`
          : COLOR.line,
      }}
    />
  );
}

export type NodeState = Urgency | "done";

/**
 * A node on the axis. `state` is the item's urgency, or `done` once it has been
 * submitted — which is the only state that animates.
 */
export function SpineNode({
  state,
  sealing = false,
}: {
  state: NodeState;
  sealing?: boolean;
}) {
  const hex = state === "done" ? DONE_HEX : URGENCY[state].hex;
  const filled = state === "late" || state === "today" || state === "done";
  const small = state === "undated";

  return (
    <span
      aria-hidden="true"
      className="relative flex items-center justify-center"
      style={{ width: SPINE.colWidth, height: "1.25rem" }}
    >
      {/* The halo. Overdue carries one at rest so it reads from the far edge of
          the screen; a completed node fires one once, as the seal. */}
      {state === "late" && (
        <span
          className="absolute rounded-full"
          style={{ width: "1.25rem", height: "1.25rem", background: `${hex}22` }}
        />
      )}
      {sealing && (
        <span
          className="pf-ring absolute rounded-full"
          style={{ width: SPINE.node, height: SPINE.node, background: DONE_HEX }}
        />
      )}

      <span
        className={`relative flex items-center justify-center rounded-full ${sealing ? "pf-seal" : ""}`}
        style={{
          width: small ? "0.4375rem" : SPINE.node,
          height: small ? "0.4375rem" : SPINE.node,
          // A hollow node still needs an opaque centre, or the rule shows
          // through the middle of it.
          background: filled ? hex : COLOR.void,
          boxShadow: filled ? "none" : `inset 0 0 0 1.5px ${COLOR.line}`,
        }}
      >
        {state === "done" && (
          <Check className="size-2" strokeWidth={4} style={{ color: COLOR.void }} />
        )}
      </span>
    </span>
  );
}

/** The live "now" marker. The single looping animation in the portal — it
 *  encodes the present moment, which is the only thing a loop may mean. */
export function NowNode() {
  return (
    <span
      aria-hidden="true"
      className="relative flex items-center justify-center"
      style={{ width: SPINE.colWidth, height: "1.25rem" }}
    >
      <span
        className="pf-now absolute rounded-full"
        style={{ width: "1.125rem", height: "1.125rem", background: `${COLOR.azure}55` }}
      />
      <span
        className="relative rounded-full"
        style={{ width: "0.5rem", height: "0.5rem", background: COLOR.azure }}
      />
    </span>
  );
}

/**
 * One day's worth of the axis: a graduation, a heading, and the rows beneath it.
 *
 * The heading is a real `<h3>` inside an `<li>` of the agenda's ordered list, so
 * the structure a sighted creator sees down the rail is the same structure a
 * screen reader walks.
 */
export function SpineGroup({
  label,
  sub,
  bucket,
  count,
  isToday = false,
  children,
}: {
  label: string;
  sub: string | null;
  bucket: Urgency;
  count: number;
  isToday?: boolean;
  children: React.ReactNode;
}) {
  const hex = URGENCY[bucket].hex;
  const loud = bucket === "late" || bucket === "today";

  return (
    <li className="relative list-none">
      {/* The rule starts below the heading's own marker so the graduation reads
          as crossing the line rather than sitting on top of it. */}
      <Rule bucket={bucket} from="1.25rem" />

      <div className="relative flex items-center gap-2 pb-3">
        {isToday ? (
          <NowNode />
        ) : (
          <span
            aria-hidden="true"
            className="flex items-center justify-center"
            style={{ width: SPINE.colWidth, height: "1.25rem" }}
          >
            {/* The graduation: a hash mark across the axis. */}
            <span
              className="h-px"
              style={{ width: "0.875rem", background: loud ? hex : COLOR.line }}
            />
          </span>
        )}

        <h3
          className="flex min-w-0 items-baseline gap-2 text-sm font-semibold"
          style={{ color: loud ? hex : COLOR.ink }}
        >
          <span className="truncate">{label}</span>
          {sub && (
            <span className="pf-mono shrink-0 text-[11px] font-normal" style={{ color: COLOR.ink3 }}>
              {sub}
            </span>
          )}
        </h3>

        <span
          className="pf-mono ml-auto shrink-0 text-[11px]"
          style={{ color: COLOR.ink3 }}
          aria-label={`${count} ${count === 1 ? "item" : "items"}`}
        >
          {count}
        </span>
      </div>

      <ul className="relative m-0 list-none p-0">{children}</ul>
    </li>
  );
}

/**
 * The terminator. The axis has to end somewhere, and ending it in a sealed node
 * is what turns "the list stopped" into "you're finished" — the portal's whole
 * emotional payoff, delivered by the same structure that carried the work.
 */
export function SpineEnd({ label }: { label: string }) {
  return (
    <li className="relative flex list-none items-center gap-2">
      <span
        aria-hidden="true"
        className="flex items-center justify-center"
        style={{ width: SPINE.colWidth, height: "1.25rem" }}
      >
        <span
          className="flex items-center justify-center rounded-full"
          style={{ width: "0.875rem", height: "0.875rem", background: `${DONE_HEX}26` }}
        >
          <span
            className="rounded-full"
            style={{ width: "0.375rem", height: "0.375rem", background: DONE_HEX }}
          />
        </span>
      </span>
      <p className="text-xs" style={{ color: COLOR.ink3 }}>
        {label}
      </p>
    </li>
  );
}
