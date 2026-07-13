/**
 * Shared shape for a resource document stored in the Firestore `app-resources`
 * collection. Client-safe (type-only) so both server services and client hooks
 * can import it without pulling in server-only code.
 *
 * Historic note: this data was migrated out of a Notion database. The
 * `notionPageUrl` / `isNotionPage` fields are retained so a row that points at a
 * Notion page (rather than an external link) still resolves to a working URL.
 */
export type ResourceIcon =
  | { type: 'emoji'; value: string }
  | { type: 'url'; value: string };

export interface ResourceDocument {
  /** Firestore document id. */
  id: string;
  name: string;
  /** External link, or the source page URL when the row is a page (never null in practice). */
  url: string | null;
  /** True when the row is a page reference rather than an explicit external link. */
  isNotionPage: boolean;
  notionPageUrl: string;
  groups: string[];
  types: string[];
  status: string;
  /** ISO 8601 timestamp of the last edit. */
  lastEditedTime: string;
  icon: ResourceIcon | null;
  /** UIDs explicitly granted visibility, in addition to group-based access. */
  users: string[];
}
