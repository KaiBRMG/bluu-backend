import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { isValidModelId } from '@/types/promptLibrary';
import { LlmPromptsFallback } from '../_components/LlmPromptsFallback';
import { LlmPromptsView } from '../_components/LlmPromptsView';

/**
 * The slug is read here, on the server, and passed down — never from
 * `useParams()`. Under Cache Components this route is partially prerendered,
 * and a client component in the prerendered shell reads the dynamic-param
 * placeholder (`%%drp:llm:…%%`) instead of the real slug, which fails
 * `isValidModelId` and 404s. Awaiting `params` is runtime data, so it happens
 * inside the Suspense boundary.
 */
export default function LlmPromptsPage({ params }: { params: Promise<{ llm: string }> }) {
  return (
    <Suspense fallback={<LlmPromptsFallback />}>
      <ResolvedLlmPrompts params={params} />
    </Suspense>
  );
}

async function ResolvedLlmPrompts({ params }: { params: Promise<{ llm: string }> }) {
  const { llm } = await params;
  // The set of models is managed data now, so the route can only reject a
  // malformed segment here; whether the model is registered is decided by the
  // view, which has the list.
  if (!isValidModelId(llm)) notFound();
  return <LlmPromptsView slug={llm} />;
}
