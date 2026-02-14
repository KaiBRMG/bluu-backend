import { TEAMSPACES } from '@/lib/definitions';
import type { TeamspaceDef } from '@/lib/definitions';

/**
 * Returns all teamspaces from code definitions (no Firestore read needed).
 */
export function getAllTeamspaces(): TeamspaceDef[] {
  return TEAMSPACES;
}
