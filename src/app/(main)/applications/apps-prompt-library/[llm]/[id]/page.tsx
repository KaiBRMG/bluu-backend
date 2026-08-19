'use client';

import { notFound, useParams } from 'next/navigation';
import { isValidModelId } from '@/types/promptLibrary';
import { LlmPromptsView } from '../../_components/LlmPromptsView';

/**
 * The prompt detail is a dialog now, not a page. This route survives only so
 * links and bookmarks made while it WAS a page still work: it renders the model
 * board and opens the named prompt on top of it, which is what a click from
 * anywhere else in the app produces anyway.
 */
export default function PromptDetailPage() {
  const params = useParams<{ llm: string; id: string }>();
  const slug = params?.llm;

  if (!isValidModelId(slug)) notFound();

  return <LlmPromptsView slug={slug} initialPromptId={params?.id} />;
}
