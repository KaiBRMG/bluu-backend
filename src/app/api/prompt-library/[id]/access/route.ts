import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { updatePromptAccess } from '@/lib/services/promptLibraryService';
import { isValidAccessKey, resolveRole, visibleAccess } from '@/lib/promptAccess';
import type { PromptAccessChange, PromptGrantTarget } from '@/types/promptLibrary';
import { withPromptAuth } from '../../_guard';

const MAX_OPS = 50;
/** 50 short operations is well under 8 KB; anything bigger is not this request. */
const MAX_BODY_BYTES = 16_000;

function parseTarget(x: unknown): PromptGrantTarget | null {
  const t = x as { kind?: unknown; id?: unknown } | null;
  if ((t?.kind !== 'user' && t?.kind !== 'group') || !isValidAccessKey(t.id)) return null;
  return { kind: t.kind, id: t.id };
}

function parseChange(body: unknown): PromptAccessChange | null {
  const b = body as { set?: unknown; remove?: unknown } | null;
  const rawSet = b?.set ?? [];
  const rawRemove = b?.remove ?? [];
  if (!Array.isArray(rawSet) || !Array.isArray(rawRemove)) return null;
  if (rawSet.length + rawRemove.length === 0 || rawSet.length + rawRemove.length > MAX_OPS) return null;

  const set: NonNullable<PromptAccessChange['set']> = [];
  for (const g of rawSet) {
    const target = parseTarget(g);
    if (!target || (g.role !== 'view' && g.role !== 'edit')) return null;
    set.push({ ...target, role: g.role });
  }
  const remove: PromptGrantTarget[] = [];
  for (const r of rawRemove) {
    const target = parseTarget(r);
    if (!target) return null;
    remove.push(target);
  }
  return { set, remove };
}

/**
 * PUT /api/prompt-library/[id]/access
 *
 * Applies a delta — `{ set: [{kind,id,role}], remove: [{kind,id}] }` — to who a
 * prompt is shared with. A delta, not the whole map, and merged in a
 * transaction, so two editors sharing at the same moment both land.
 *
 * Tier 2 (page permission) plus EDIT on this prompt. Editors manage sharing by
 * design; the organisation (admins) owns every prompt implicitly and is not a
 * stored grant, so there is no last-owner problem and nobody can be locked out
 * of the library by removing themselves. The Share dialog confirms a
 * self-removal first.
 *
 * Responds with what the caller now holds, so the client patches state instead
 * of re-reading the library. Never cached: it is a write.
 */
export const PUT = withPromptAuth('prompt-library access PUT', 'edit', async (req, { id, token, viewer }) => {
  const read = await readJsonBody(req, MAX_BODY_BYTES);
  if (!read.ok) return read.response;

  const change = parseChange(read.body);
  if (!change) return NextResponse.json({ error: 'Malformed access change' }, { status: 400 });

  const result = await updatePromptAccess(id, change, token.uid);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Removing your own last grant leaves a non-admin with nothing, and dropping
  // yourself to view-only hides the map — so say what the caller holds NOW.
  // `myRole: null` tells the client to drop the prompt from its board.
  const resolved = resolveRole(result.access, viewer);
  return NextResponse.json({
    access: resolved ? visibleAccess(result.access, resolved.role) : null,
    myRole: resolved?.role ?? null,
    viaAdmin: resolved?.viaAdmin ?? false,
  });
});
