'use client';

import { useState } from 'react';
import { MoreHorizontal, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ResourceDocument } from '@/types/resource';
import { colorForType } from '@/app/(main)/applications/apps-resources/components/typeColors';

function ResourceIcon({ icon }: { icon: ResourceDocument['icon'] }) {
  if (!icon) return <span className="text-muted-foreground">•</span>;
  if (icon.type === 'emoji') {
    return <span className="text-base leading-none">{icon.value}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={icon.value} alt="" className="h-5 w-5 rounded-sm object-cover" />;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ResourceTable({
  resources,
  groupLabel,
  onEdit,
  onDelete,
}: {
  resources: ResourceDocument[];
  groupLabel: (id: string) => string;
  onEdit: (resource: ResourceDocument) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [pendingDelete, setPendingDelete] = useState<ResourceDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      toast.success('Resource deleted');
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete resource');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Icon &amp; Name</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Edited</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Types</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No resources match your filters.
                </TableCell>
              </TableRow>
            ) : (
              resources.map(r => {
                const url = r.url ?? r.notionPageUrl;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                          <ResourceIcon icon={r.icon} />
                        </span>
                        <span className="font-medium truncate max-w-[16rem]">
                          {r.name || 'Untitled'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[14rem]">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground truncate"
                        >
                          <span className="truncate">{url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          r.status === 'Active'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground border-border'
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(r.lastEditedTime)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.groups.length === 0
                          ? <span className="text-muted-foreground">—</span>
                          : r.groups.map(g => (
                              <Badge
                                key={g}
                                variant="outline"
                                className="bg-muted text-muted-foreground border-border font-medium"
                              >
                                {groupLabel(g)}
                              </Badge>
                            ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.types.length === 0
                          ? <span className="text-muted-foreground">—</span>
                          : r.types.map(t => {
                              const c = colorForType(t);
                              return (
                                <Badge key={t} variant="outline" className={`${c.badge} font-medium`}>
                                  {t}
                                </Badge>
                              );
                            })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Open options</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onEdit(r)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setPendingDelete(r)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={o => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete resource?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="font-medium">{pendingDelete?.name}</span> from
              the resources collection. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
