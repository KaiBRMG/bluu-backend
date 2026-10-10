import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { isValidModelId } from '@/types/promptLibrary';
import { LlmPromptsFallback } from '../../_components/LlmPromptsFallback';
import { LlmPromptsView } from '../../_components/LlmPromptsView';

/**
 * The prompt detail is a dialog now, not a page. This route survives only so
 * links and bookmarks made while it WAS a page still work: it renders the model
 * board and opens the named prompt on top of it, which is what a click from
 * anywhere else in the app produces anyway.
 *
 * Params are read on the server and passed down — see `../page.tsx` for why
 * `useParams()` cannot be used on this partially prerendered route.
 */
export default function PromptDetailPage({ params }: { params: Promise<{ llm: string; id: string }> }) {
  return (
    <Suspense fallback={<LlmPromptsFallback />}>
      <ResolvedPromptDetail params={params} />
    </Suspense>
  );
}

async function ResolvedPromptDetail({ params }: { params: Promise<{ llm: string; id: string }> }) {
  const { llm, id } = await params;
  if (!isValidModelId(llm)) notFound();
  return <LlmPromptsView slug={llm} initialPromptId={id} />;
}
