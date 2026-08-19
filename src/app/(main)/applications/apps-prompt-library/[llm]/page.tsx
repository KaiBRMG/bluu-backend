'use client';

import { notFound, useParams } from 'next/navigation';
import { isValidModelId } from '@/types/promptLibrary';
import { LlmPromptsView } from '../_components/LlmPromptsView';

export default function LlmPromptsPage() {
  const params = useParams<{ llm: string }>();
  const slug = params?.llm;

  // The set of models is managed data now, so the route can only reject a
  // malformed segment here; whether the model is registered is decided by the
  // view, which has the list.
  if (!isValidModelId(slug)) notFound();

  return <LlmPromptsView slug={slug} />;
}
