'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDownIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useBasicUsers } from '@/hooks/useBasicUsers';

function Block() {
  return <Skeleton className="h-64 w-full rounded-xl" />;
}

const OrganizationSettings = dynamic(() => import('../OrganizationSettings'), { loading: Block });
const AdminLeave = dynamic(() => import('../AdminLeave'), { loading: Block });
const BatchDeleteDialog = dynamic(() => import('../AdminScreenshots').then(m => m.BatchDeleteDialog));

/**
 * The policy and the operations that act on everyone at once. Anything about
 * one person lives in their panel instead; this view is for the whole roster.
 */
export default function SettingsView({ onOpenScreenshots }: { onOpenScreenshots: (uid: string) => void }) {
  const [batchOpen, setBatchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { users } = useBasicUsers();

  // Archived people included on purpose: their screenshots are still in storage
  // and must stay viewable and deletable (user-management.md — intentional
  // exceptions). This is the one picker on the page that keeps them.
  const everyone = useMemo(
    () => [...users].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', undefined, { sensitivity: 'base' })),
    [users],
  );

  return (
    <div className="space-y-12">
      <OrganizationSettings />

      <AdminLeave />

      <section>
        <h2 className="text-lg font-semibold">Screenshot storage</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-zinc-400">
          Delete screenshots for several people over a date range, or open anyone&apos;s screenshots — including
          people who have been archived.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBatchOpen(true)}>
            <Trash2 /> Delete screenshots in bulk…
          </Button>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="text-zinc-300">
                Open a person&apos;s screenshots <ChevronDownIcon />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="dark w-64 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search people…" />
                <CommandList>
                  <CommandEmpty>No one found.</CommandEmpty>
                  <CommandGroup>
                    {everyone.map(u => (
                      <CommandItem
                        key={u.uid}
                        value={`${u.displayName} ${u.uid}`}
                        onSelect={() => { setPickerOpen(false); onOpenScreenshots(u.uid); }}
                      >
                        <span className="truncate">{u.displayName || 'User'}</span>
                        {u.isArchived && <span className="ml-auto text-[11px] text-zinc-400">Archived</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        {batchOpen && <BatchDeleteDialog onClose={() => setBatchOpen(false)} />}
      </section>
    </div>
  );
}
