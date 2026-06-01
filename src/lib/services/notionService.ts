import 'server-only';
import { Client } from '@notionhq/client';
import { unstable_cache } from 'next/cache';

export type NotionIcon =
  | { type: 'emoji'; value: string }
  | { type: 'url'; value: string };

export interface NotionDocument {
  id: string;
  name: string;
  url: string | null;
  notionPageUrl: string;
  groups: string[];
  types: string[];
  status: 'Active' | 'Unlisted';
  lastEditedTime: string;
  icon: NotionIcon | null;
}

let _client: Client | null = null;
function getClient(): Client {
  if (!_client) {
    const auth = process.env.NOTION_TOKEN;
    if (!auth) throw new Error('NOTION_TOKEN env var is not set');
    _client = new Client({ auth });
  }
  return _client;
}

function getDatabaseId(): string {
  const id = process.env.NOTION_DATABASE_ID;
  if (!id) throw new Error('NOTION_DATABASE_ID env var is not set');
  return id;
}

// Notion's TS types for `databases.query` results are a heavy union; narrow with `any`
// at the property-extraction boundary and validate shape at runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */

function readTitle(prop: any): string {
  if (!prop || prop.type !== 'title') return '';
  return (prop.title ?? []).map((t: any) => t?.plain_text ?? '').join('').trim();
}

function readUrl(prop: any): string | null {
  if (!prop || prop.type !== 'url') return null;
  const u = prop.url;
  return typeof u === 'string' && u.length > 0 ? u : null;
}

function readMultiSelect(prop: any): string[] {
  if (!prop || prop.type !== 'multi_select') return [];
  return (prop.multi_select ?? []).map((s: any) => s?.name).filter(Boolean);
}

function readStatus(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === 'status') return prop.status?.name ?? null;
  if (prop.type === 'select') return prop.select?.name ?? null;
  return null;
}

function readIcon(icon: any): NotionIcon | null {
  if (!icon) return null;
  if (icon.type === 'emoji' && typeof icon.emoji === 'string') {
    return { type: 'emoji', value: icon.emoji };
  }
  if (icon.type === 'external' && icon.external?.url) {
    return { type: 'url', value: icon.external.url };
  }
  if (icon.type === 'file' && icon.file?.url) {
    return { type: 'url', value: icon.file.url };
  }
  return null;
}

async function fetchActiveDocumentsRaw(): Promise<NotionDocument[]> {
  const notion = getClient();
  const database_id = getDatabaseId();

  const docs: NotionDocument[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res: any = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results ?? []) {
      if (page.object !== 'page' || !('properties' in page)) continue;
      const props = page.properties ?? {};

      const statusName = readStatus(props['Status']);
      if (statusName !== 'Active') continue;

      docs.push({
        id: page.id,
        name: readTitle(props['Name']),
        url: readUrl(props['URL']),
        notionPageUrl: page.url ?? '',
        groups: readMultiSelect(props['Groups']),
        types: readMultiSelect(props['Type']),
        status: 'Active',
        lastEditedTime: page.last_edited_time ?? new Date().toISOString(),
        icon: readIcon(page.icon),
      });
    }

    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  docs.sort((a, b) =>
    new Date(b.lastEditedTime).getTime() - new Date(a.lastEditedTime).getTime()
  );
  return docs;
}

export const getActiveDocuments = unstable_cache(
  fetchActiveDocumentsRaw,
  ['notion-resources-active-docs'],
  { revalidate: 300, tags: ['notion-resources'] },
);

async function fetchDocumentTypesRaw(): Promise<string[]> {
  const docs = await fetchActiveDocumentsRaw();
  const set = new Set<string>();
  for (const d of docs) for (const t of d.types) set.add(t);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export const getDocumentTypes = unstable_cache(
  fetchDocumentTypesRaw,
  ['notion-resources-types'],
  { revalidate: 3600, tags: ['notion-resources'] },
);
