import { PromptLibraryProvider } from '@/contexts/PromptLibraryContext';

/**
 * One provider for the whole Prompt Library subtree. The home screen, each LLM
 * page and every detail card share a single fetch of the library, so moving
 * between them costs no further Firestore reads.
 */
export default function PromptLibraryLayout({ children }: { children: React.ReactNode }) {
  return <PromptLibraryProvider>{children}</PromptLibraryProvider>;
}
