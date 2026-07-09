'use client';

import { format } from 'date-fns';
import { EllipsisIcon } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LinkWithCopy } from '@/components/smm/shared/LinkWithCopy';
import { EllipsisPagination } from '@/components/EllipsisPagination';
import type { SmmPost } from '@/types/firestore';

export type PostColumnKey = 'accountName' | 'postDate' | 'postLink' | 'caption';

const COLUMN_LABELS: Record<PostColumnKey, string> = {
  accountName: 'Account',
  postDate: 'Post Date',
  postLink: 'Post Link',
  caption: 'Caption',
};

export type PostAction = 'view' | 'edit' | 'delete' | 'bonus';

const ACTION_LABELS: Record<PostAction, string> = {
  view: 'View',
  edit: 'Edit',
  delete: 'Delete',
  bonus: '💰 Submit for Bonus',
};

/** Long captions truncate to a hover-card trigger (DisputeTable CommentCell pattern). */
function CaptionCell({ caption }: { caption: string }) {
  if (!caption) return <span className="text-muted-foreground">—</span>;
  if (caption.length <= 30) return <span>{caption}</span>;
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link" className="h-auto p-0 text-sm font-normal text-foreground underline-offset-4">
          {caption.slice(0, 30)}…
        </Button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <p className="text-sm break-words whitespace-pre-wrap">{caption}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

function PostActionPopover({
  post,
  actions,
  onAction,
}: {
  post: SmmPost;
  actions: PostAction[];
  onAction: (action: PostAction, post: SmmPost) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="p-1 rounded hover:bg-muted transition-colors" aria-label="Actions">
          <EllipsisIcon className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <div className="flex flex-col gap-0.5">
          {actions.map((action) => (
            <button
              key={action}
              className={`w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors ${action === 'delete' ? 'text-red-600' : ''}`}
              onClick={() => onAction(action, post)}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Column-configurable posts table shared by "Show All Posts" and the account
 * dialog's Content tab. Pagination renders only when totalPages is provided.
 */
export function PostsTable({
  posts,
  columns,
  actions,
  loading,
  page,
  totalPages,
  onPageChange,
  onAction,
}: {
  posts: SmmPost[];
  columns: PostColumnKey[];
  actions: PostAction[];
  loading: boolean;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  onAction: (action: PostAction, post: SmmPost) => void;
}) {
  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>;
  }
  if (posts.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No posts found.</div>;
  }

  const cellValue = (post: SmmPost, col: PostColumnKey) => {
    switch (col) {
      case 'accountName':
        return <span className="font-medium">{post.accountName}</span>;
      case 'postDate':
        return (
          <span className="whitespace-nowrap">
            {post.postDate ? format(new Date(post.postDate), 'PP') : '—'}
          </span>
        );
      case 'postLink':
        return post.postLink
          ? <LinkWithCopy url={post.postLink} className="max-w-48" />
          : <span className="text-muted-foreground">—</span>;
      case 'caption':
        return <CaptionCell caption={post.caption} />;
    }
  };

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => <TableHead key={col}>{COLUMN_LABELS[col]}</TableHead>)}
            {actions.length > 0 && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.map((post) => (
            <TableRow key={`${post.accountId}-${post.id}`}>
              {columns.map((col) => <TableCell key={col}>{cellValue(post, col)}</TableCell>)}
              {actions.length > 0 && (
                <TableCell className="text-right">
                  <PostActionPopover post={post} actions={actions} onAction={onAction} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {page !== undefined && totalPages !== undefined && onPageChange && (
        <EllipsisPagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
      )}
    </div>
  );
}
