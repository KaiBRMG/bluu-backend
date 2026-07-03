"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  Plus,
  Trash2,
  Trophy,
  Users,
  Gift,
  Ticket,
  Sparkles,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Participant = { id: string; name: string; tickets: number };
type Segment = { name: string; participantId: string };
type Winner = { name: string; prize: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TICK_SRC = "/raffle/Tick - Sound Effect (HD).mp3";
const VICTORY_SRC = "/raffle/Old victory sound roblox.mp3";
const WHEEL_SIZE = 500;
const SPIN_DURATION_MS = 6500;
const AUTO_ADVANCE_SECONDS = 5;
const GOLD = "#F4C752";
const GOLD_DEEP = "#C9961F";
const CONFETTI_COLORS = ["#F4C752", "#FFA63D", "#ffffff", "#ff5e7e", "#5ecbff", "#8b6bff"];
// Above this many segments, names no longer fit on the wheel — the legend picks up the slack.
const WHEEL_LABEL_THRESHOLD = 70;
const DEFAULT_PRIZES = ["$75", "$60", "$55", "$45", "$35", "$30", "$25", "$25", "$25", "$25"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Random float in [0, 1) backed by crypto for a genuinely random spin. */
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

/** Segment index sitting under the fixed top pointer for a given rotation (deg). */
function indexAtRotation(rotationDeg: number, count: number): number {
  if (count === 0) return -1;
  const segDeg = 360 / count;
  const phi = (((-rotationDeg) % 360) + 360) % 360;
  return Math.floor(phi / segDeg) % count;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function RafflePage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [prizes, setPrizes] = useState<string[]>(DEFAULT_PRIZES);
  const [winners, setWinners] = useState<Winner[]>([]);

  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);

  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [prizesOpen, setPrizesOpen] = useState(false);
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lastWinner, setLastWinner] = useState<Winner | null>(null);
  const [countdown, setCountdown] = useState(AUTO_ADVANCE_SECONDS);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const tickBufferRef = useRef<AudioBuffer | null>(null);
  const lastTickRef = useRef(0);
  const victoryRef = useRef<HTMLAudioElement | null>(null);

  // -------------------------------------------------------------------------
  // Derived wheel segments (one per ticket)
  //
  // Built incrementally rather than rebuilt-and-reshuffled on every change: existing
  // ticket slots keep their position in the array (and therefore their angular slot on
  // the wheel) across renders. Only the *delta* — new tickets from an added participant,
  // or tickets consumed by a win — touches the array. This is what keeps a segment's
  // color anchored in place instead of the whole wheel visually reshuffling right as the
  // winner dialog opens.
  // -------------------------------------------------------------------------
  const segmentsRef = useRef<Segment[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);

  useEffect(() => {
    const desired = new Map<string, { name: string; tickets: number }>();
    for (const p of participants) {
      const name = p.name.trim();
      if (!name || p.tickets < 1) continue;
      desired.set(p.id, { name, tickets: p.tickets });
    }

    // Keep existing slots (up to the now-desired count) in their current order/position.
    const kept = new Map<string, number>();
    const next: Segment[] = [];
    for (const s of segmentsRef.current) {
      const d = desired.get(s.participantId);
      if (!d) continue;
      const used = kept.get(s.participantId) ?? 0;
      if (used >= d.tickets) continue;
      kept.set(s.participantId, used + 1);
      next.push(s);
    }

    // Any shortfall (new participant, or ticket count increased) becomes new slots,
    // shuffled among themselves and spliced into random positions so they scatter
    // rather than cluster — without disturbing any slot that was already kept above.
    const additions: Segment[] = [];
    for (const [participantId, d] of desired) {
      const have = kept.get(participantId) ?? 0;
      for (let i = have; i < d.tickets; i++) {
        additions.push({ name: d.name, participantId });
      }
    }
    for (let i = additions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [additions[i], additions[j]] = [additions[j], additions[i]];
    }
    for (const seg of additions) {
      const idx = Math.floor(Math.random() * (next.length + 1));
      next.splice(idx, 0, seg);
    }

    segmentsRef.current = next;
    setSegments(next);
  }, [participants]);

  const totalTickets = segments.length;
  const nextPrize = prizes[0] ?? null;
  const canSpin = !isSpinning && prizes.length > 0 && totalTickets > 0;

  // One stable colour per participant, assigned once on first appearance and cached
  // for the lifetime of the raffle so it never reshuffles on spin/win/removal — shared
  // by the wheel canvas and the legend. Keyed off `participants` (stable insertion
  // order), not the shuffled `segments`, so removing a winner can't shift anyone
  // else's hue.
  const colorAssignmentsRef = useRef(new Map<string, string>());
  const participantColors = useMemo(() => {
    const colors = colorAssignmentsRef.current;
    for (const p of participants) {
      if (!colors.has(p.id)) {
        const hue = (colors.size * 137.508) % 360;
        colors.set(p.id, `hsl(${hue} 68% 52%)`);
      }
    }
    return colors;
  }, [participants]);

  // Legend rows (one per active participant), in stable add order — only needed once
  // the wheel has too many segments to print names on directly.
  const legendEntries = useMemo(() => {
    const activeIds = new Set(segments.map((s) => s.participantId));
    return participants
      .filter((p) => activeIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name.trim(),
        color: participantColors.get(p.id) ?? "hsl(0 0% 50%)",
      }));
  }, [participants, segments, participantColors]);

  // -------------------------------------------------------------------------
  // Audio setup
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Web Audio: decode the tick once, then fire a fresh source node per tick.
    // This allows arbitrarily rapid, fully overlapping playback with no
    // interruption — unlike a pool of <audio> elements, which drop ticks when
    // the wheel spins fast enough to retrigger a clip before it finishes.
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext | null = null;
    if (AC) {
      ctx = new AC();
      audioCtxRef.current = ctx;
      fetch(TICK_SRC)
        .then((res) => res.arrayBuffer())
        .then((buf) => ctx!.decodeAudioData(buf))
        .then((decoded) => {
          tickBufferRef.current = decoded;
        })
        .catch(() => {});
    }

    const victory = new Audio(VICTORY_SRC);
    victory.volume = 0.7;
    victory.preload = "auto";
    victoryRef.current = victory;

    return () => {
      void ctx?.close().catch(() => {});
      audioCtxRef.current = null;
      tickBufferRef.current = null;
      victoryRef.current = null;
    };
  }, []);

  const playTick = useCallback(() => {
    const ctx = audioCtxRef.current;
    const buffer = tickBufferRef.current;
    if (!ctx || !buffer) return;
    // Keep ticks crisp/distinct even at top speed (cap ~one every 22ms).
    const now = performance.now();
    if (now - lastTickRef.current < 22) return;
    lastTickRef.current = now;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    source.connect(gain).connect(ctx.destination);
    source.start();
  }, []);

  // -------------------------------------------------------------------------
  // Draw the wheel (only when segments change)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = WHEEL_SIZE;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 6;
    const n = segments.length;

    if (n === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(244,199,82,0.35)";
      ctx.stroke();
      return;
    }

    const seg = (Math.PI * 2) / n;
    const fontSize = Math.max(9, Math.min(20, 420 / n));
    const maxChars = Math.max(4, Math.floor(fontSize * 1.4));

    // Pass 1: fill + stroke every wedge first. Doing this in its own pass (rather than
    // interleaved with text below) guarantees no wedge's fill can ever be painted on
    // top of a neighboring wedge's label — at high segment counts a label's inner edge
    // can visually spill a few pixels into the next wedge, and if that wedge's fill
    // were drawn afterward (as it was in the old interleaved loop) it would erase part
    // of the label, leaving only a stray character or two behind.
    for (let i = 0; i < n; i++) {
      const start = i * seg - Math.PI / 2;
      const end = start + seg;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();

      ctx.fillStyle = participantColors.get(segments[i].participantId) ?? "hsl(0 0% 50%)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.stroke();
    }

    // Pass 2: labels, now that every wedge is already finalized underneath.
    if (n <= WHEEL_LABEL_THRESHOLD) {
      for (let i = 0; i < n; i++) {
        const start = i * seg - Math.PI / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(start + seg / 2);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.96)";
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 3;
        ctx.fillText(truncate(segments[i].name, maxChars), r - 16, 0);
        ctx.restore();
      }
    }

    // Outer gold rim
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = GOLD;
    ctx.shadowColor = "rgba(244,199,82,0.6)";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Center hub backing (the SPIN button sits on top of this)
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = "#0e0e12";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
  }, [segments, participantColors]);

  // -------------------------------------------------------------------------
  // Confetti burst
  // -------------------------------------------------------------------------
  const fireConfetti = useCallback(() => {
    confetti({
      particleCount: 140,
      spread: 100,
      startVelocity: 45,
      origin: { y: 0.6 },
      colors: CONFETTI_COLORS,
    });
    const end = Date.now() + 1300;
    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: CONFETTI_COLORS });
      confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: CONFETTI_COLORS });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, []);

  // -------------------------------------------------------------------------
  // Award the winner
  // -------------------------------------------------------------------------
  const handleWin = useCallback(
    (index: number) => {
      const seg = segments[index];
      const prize = prizes[0];
      if (!seg || !prize) return;

      try {
        if (victoryRef.current) {
          victoryRef.current.currentTime = 0;
          void victoryRef.current.play().catch(() => {});
        }
      } catch {
        /* ignore */
      }
      fireConfetti();

      setLastWinner({ name: seg.name, prize });
      setWinnerOpen(true);
      setWinners((prev) => [...prev, { name: seg.name, prize }]);
      setPrizes((prev) => prev.slice(1));
      setParticipants((prev) =>
        prev
          .map((p) =>
            p.id === seg.participantId ? { ...p, tickets: p.tickets - Math.ceil(p.tickets / 2) } : p,
          )
          .filter((p) => p.tickets > 0),
      );
    },
    [segments, prizes, fireConfetti],
  );

  // -------------------------------------------------------------------------
  // Spin
  // -------------------------------------------------------------------------
  const spin = useCallback(() => {
    if (!canSpin) return;
    const count = segments.length;

    // Unlock/resume Web Audio within the user gesture so ticks can play.
    if (audioCtxRef.current?.state === "suspended") {
      void audioCtxRef.current.resume().catch(() => {});
    }

    setIsSpinning(true);

    const start = rotationRef.current;
    const extraTurns = 6 + Math.floor(cryptoRandom() * 4); // 6–9 full turns
    const target = start + extraTurns * 360 + cryptoRandom() * 360;
    const startTime = performance.now();
    let lastIndex = indexAtRotation(start, count);

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / SPIN_DURATION_MS);
      const current = start + (target - start) * easeOutQuart(t);
      rotationRef.current = current;
      if (wheelRef.current) {
        wheelRef.current.style.transform = `rotate(${current}deg)`;
      }
      const idx = indexAtRotation(current, count);
      if (idx !== lastIndex) {
        playTick();
        lastIndex = idx;
      }
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        setRotation(current);
        setIsSpinning(false);
        handleWin(indexAtRotation(current, count));
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, [canSpin, segments, playTick, handleWin]);

  // Cancel any in-flight animation on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // What happens when the winner dialog auto-advances (or is skipped): close it
  // and either spin again, or — if every prize is gone — reveal the full list.
  // Stored in a ref so the countdown effect always calls the latest closure.
  const advanceRef = useRef<() => void>(() => {});
  advanceRef.current = () => {
    setWinnerOpen(false);
    if (prizes.length > 0) {
      spin();
    } else {
      setSummaryOpen(true);
    }
  };

  // While the winner dialog is open, count down then auto-advance.
  useEffect(() => {
    if (!winnerOpen) return;
    setCountdown(AUTO_ADVANCE_SECONDS);
    const interval = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    const timeout = setTimeout(() => advanceRef.current(), AUTO_ADVANCE_SECONDS * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [winnerOpen]);

  // -------------------------------------------------------------------------
  // Participant / prize editing
  // -------------------------------------------------------------------------
  const addParticipant = () =>
    setParticipants((prev) => [...prev, { id: crypto.randomUUID(), name: "", tickets: 1 }]);
  const updateParticipantName = (id: string, name: string) =>
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  const updateParticipantTickets = (id: string, raw: string) => {
    const parsed = parseInt(raw, 10);
    const tickets = Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, tickets } : p)));
  };
  const removeParticipant = (id: string) =>
    setParticipants((prev) => prev.filter((p) => p.id !== id));

  const addPrize = () => setPrizes((prev) => [...prev, ""]);
  const updatePrize = (index: number, value: string) =>
    setPrizes((prev) => prev.map((p, i) => (i === index ? value : p)));
  const removePrize = (index: number) => setPrizes((prev) => prev.filter((_, i) => i !== index));
  const movePrize = (index: number, dir: -1 | 1) =>
    setPrizes((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const closeParticipants = (open: boolean) => {
    setParticipantsOpen(open);
    if (!open) {
      setParticipants((prev) => prev.filter((p) => p.name.trim() !== "" && p.tickets >= 1));
    }
  };
  const closePrizes = (open: boolean) => {
    setPrizesOpen(open);
    if (!open) {
      setPrizes((prev) => prev.map((p) => p.trim()).filter((p) => p !== ""));
    }
  };

  // When the winner dialog closes and prizes are gone, reveal the summary
  const onWinnerOpenChange = (open: boolean) => {
    setWinnerOpen(open);
    if (!open && prizes.length === 0 && winners.length > 0) {
      setSummaryOpen(true);
    }
  };

  const resetAll = () => {
    if (isSpinning) return;
    setParticipants([]);
    setPrizes(DEFAULT_PRIZES);
    setWinners([]);
    setLastWinner(null);
    setWinnerOpen(false);
    setSummaryOpen(false);
    rotationRef.current = 0;
    setRotation(0);
    colorAssignmentsRef.current.clear();
    toast.success("Raffle reset");
  };

  const spinHint = isSpinning
    ? "Spinning…"
    : totalTickets === 0
      ? "Add participants to begin"
      : prizes.length === 0
        ? winners.length > 0
          ? "All prizes awarded 🎉"
          : "Add prizes to begin"
        : "Ready to spin";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08080b] text-white">
      {/* Atmosphere */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% -10%, rgba(244,199,82,0.16), transparent 55%), radial-gradient(90% 70% at 50% 120%, rgba(139,107,255,0.14), transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, #fff 0, #fff 1px, transparent 1px, transparent 28px), repeating-linear-gradient(90deg, #fff 0, #fff 1px, transparent 1px, transparent 28px)",
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8">
        {/* Header */}
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em]"
              style={{ color: GOLD }}
            >
              <Sparkles className="size-3.5" />
              Bluu Rock
            </div>
            <h1
              className="mt-2 text-5xl font-bold leading-none tracking-tight"
              style={{
                backgroundImage: `linear-gradient(180deg, #fff 30%, ${GOLD} 130%)`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Chatter Champions Raffle
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            disabled={isSpinning}
            className="text-white/50 hover:text-white"
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </header>

        <div className="flex flex-1 flex-col items-center gap-10 lg:flex-row lg:items-center lg:justify-center">
          {/* Wheel */}
          <div className="flex flex-col items-center gap-6">
            <div
              className="relative"
              style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, maxWidth: "86vw", maxHeight: "86vw" }}
            >
              {/* Pointer */}
              <div className="absolute left-1/2 top-[-6px] z-20 -translate-x-1/2">
                <div
                  className="size-0"
                  style={{
                    borderLeft: "18px solid transparent",
                    borderRight: "18px solid transparent",
                    borderTop: `30px solid ${GOLD}`,
                    filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.5))",
                  }}
                />
              </div>

              {/* Glow ring */}
              <div
                className="pointer-events-none absolute inset-[-18px] rounded-full"
                style={{ boxShadow: "0 0 80px 8px rgba(244,199,82,0.18)" }}
              />

              {/* Rotating canvas */}
              <div
                ref={wheelRef}
                className="absolute inset-0"
                style={{ transform: `rotate(${rotation}deg)`, willChange: "transform" }}
              >
                <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
              </div>

              {/* Center SPIN button */}
              <button
                type="button"
                onClick={spin}
                disabled={!canSpin}
                className={cn(
                  "absolute left-1/2 top-1/2 z-10 flex aspect-square w-[24%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-sm font-bold uppercase tracking-widest transition-all",
                  "shadow-[0_8px_24px_rgba(0,0,0,0.55)]",
                  canSpin
                    ? "cursor-pointer text-black hover:scale-105 active:scale-95"
                    : "cursor-not-allowed text-white/40",
                )}
                style={{
                  background: canSpin
                    ? `radial-gradient(circle at 35% 30%, #ffe9a8, ${GOLD} 45%, ${GOLD_DEEP})`
                    : "radial-gradient(circle at 35% 30%, #2a2a31, #15151a)",
                  border: `3px solid ${canSpin ? "#fff3cf" : "#3a3a42"}`,
                }}
              >
                {isSpinning ? "…" : "Spin"}
              </button>
            </div>

            <p className="text-sm font-medium text-white/55">{spinHint}</p>
          </div>

          {/* Control panel */}
          <aside className="w-full max-w-sm space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Users className="size-4" />}
                label="Participants"
                value={participants.filter((p) => p.name.trim() && p.tickets >= 1).length}
              />
              <StatCard icon={<Ticket className="size-4" />} label="Total Tickets" value={totalTickets} />
            </div>

            {/* Up next */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                <Gift className="size-3.5" />
                Up next
              </div>
              <div className="mt-1.5 truncate text-2xl font-semibold" style={{ color: nextPrize ? GOLD : undefined }}>
                {nextPrize ?? <span className="text-white/30">No prizes yet</span>}
              </div>
              <div className="mt-1 text-xs text-white/40">
                {prizes.length} prize{prizes.length === 1 ? "" : "s"} remaining
              </div>
            </div>

            {/* Prize queue — clipped, not scrollable: overflow prizes stay hidden and
                shift into view as prizes above them are awarded. */}
            {prizes.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <ol className="max-h-40 space-y-1.5 overflow-hidden">
                  {prizes.map((prize, i) => (
                    <li
                      key={`${prize}-${i}`}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm",
                        i === 0 ? "text-white" : "text-white/70",
                      )}
                      style={i === 0 ? { background: "rgba(244,199,82,0.1)" } : undefined}
                    >
                      <Badge variant={i === 0 ? "default" : "secondary"} className="shrink-0">
                        {i + 1}
                      </Badge>
                      <span className="truncate">{prize}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Legend — only needed once the wheel has too many segments to label directly */}
            {legendEntries.length > 0 && segments.length > WHEEL_LABEL_THRESHOLD && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 px-0.5 text-xs font-semibold uppercase tracking-wider text-white/45">
                  <Users className="size-3.5" />
                  Legend
                </div>
                <ScrollArea className="mt-2 max-h-40">
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-1 pr-3">
                    {legendEntries.map((entry) => (
                      <li key={entry.id} className="flex items-center gap-1.5 text-xs text-white/70">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: entry.color }}
                        />
                        <span className="truncate">{entry.name}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}

            <Separator className="bg-white/10" />

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setParticipantsOpen(true)} disabled={isSpinning}>
                <Users className="size-4" />
                Participants
              </Button>
              <Button variant="secondary" onClick={() => setPrizesOpen(true)} disabled={isSpinning}>
                <Gift className="size-4" />
                Prizes
              </Button>
            </div>
            <Button
              variant="outline"
              className="w-full border-white/15 bg-transparent text-white hover:bg-white/5"
              onClick={() => setSummaryOpen(true)}
              disabled={winners.length === 0}
            >
              <Trophy className="size-4" />
              Show winners {winners.length > 0 && `(${winners.length})`}
            </Button>
          </aside>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Participants dialog */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={participantsOpen} onOpenChange={closeParticipants}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-5" style={{ color: GOLD }} />
              Participants
            </DialogTitle>
            <DialogDescription>
              Each person appears on the wheel once per ticket they hold.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span>Name</span>
            <span className="w-20 text-center">Tickets</span>
            <span className="w-9" />
          </div>

          <ScrollArea className="max-h-[45vh]">
            <div className="space-y-2 pr-3">
              {participants.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No participants yet. Add your first below.
                </p>
              )}
              {participants.map((p) => (
                <div key={p.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <Input
                    value={p.name}
                    placeholder="Name"
                    onChange={(e) => updateParticipantName(p.id, e.target.value)}
                  />
                  <Input
                    type="number"
                    min={1}
                    value={p.tickets}
                    className="w-20 text-center"
                    onChange={(e) => updateParticipantTickets(p.id, e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeParticipant(p.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={addParticipant}>
              <Plus className="size-4" />
              Add participant
            </Button>
            <Button onClick={() => closeParticipants(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Prizes dialog */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={prizesOpen} onOpenChange={closePrizes}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="size-5" style={{ color: GOLD }} />
              Prizes
            </DialogTitle>
            <DialogDescription>
              Awarded top to bottom — the prize at the top goes to the next winner.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[45vh]">
            <div className="space-y-2 pr-3">
              {prizes.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No prizes yet. Add your first below.
                </p>
              )}
              {prizes.map((prize, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Badge variant="secondary" className="shrink-0">
                    {i + 1}
                  </Badge>
                  <Input
                    value={prize}
                    placeholder={`Prize ${i + 1}`}
                    onChange={(e) => updatePrize(i, e.target.value)}
                  />
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => movePrize(i, -1)}
                      disabled={i === 0}
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePrize(i, 1)}
                      disabled={i === prizes.length - 1}
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removePrize(i)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={addPrize}>
              <Plus className="size-4" />
              Add prize
            </Button>
            <Button onClick={() => closePrizes(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Winner dialog */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={winnerOpen} onOpenChange={onWinnerOpenChange}>
        <DialogContent className="overflow-hidden sm:max-w-md" style={{ borderColor: "rgba(244,199,82,0.4)" }}>
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: `radial-gradient(80% 60% at 50% 0%, ${GOLD}22, transparent 70%)` }}
          />
          <div className="relative flex flex-col items-center gap-3 py-4 text-center">
            <div
              className="flex size-20 items-center justify-center rounded-full"
              style={{ background: `radial-gradient(circle at 35% 30%, #ffe9a8, ${GOLD} 50%, ${GOLD_DEEP})` }}
            >
              <Trophy className="size-10 text-black" />
            </div>
            <DialogTitle className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
              Winner
            </DialogTitle>
            <p className="max-w-full break-words text-4xl font-bold tracking-tight">{lastWinner?.name}</p>
            <p className="text-white/60">wins</p>
            <Badge className="px-4 py-1.5 text-base" style={{ background: GOLD, color: "#000" }}>
              <PartyPopper className="size-4" />
              {lastWinner?.prize}
            </Badge>
            <Button className="mt-3 w-full" onClick={() => advanceRef.current()}>
              {prizes.length > 0
                ? `Continue in ${countdown}s`
                : `Continue in ${countdown}s`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Winners summary dialog */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="size-5" style={{ color: GOLD }} />
              All Winners
            </DialogTitle>
            <DialogDescription>
              {winners.length === 0
                ? "No winners drawn yet."
                : `${winners.length} prize${winners.length === 1 ? "" : "s"} awarded${prizes.length === 0 ? " — that's everything!" : ""}.`}
            </DialogDescription>
          </DialogHeader>

          {/* No scroll container here on purpose — every winner should be visible at
              once without needing to scroll the list. */}
          <ol className="space-y-2">
            {winners.map((w, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-black"
                    style={{ background: GOLD }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-semibold">{w.name}</span>
                </div>
                <span className="truncate text-right text-sm text-white/70">{w.prize}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helper
// ---------------------------------------------------------------------------
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-white/45">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
