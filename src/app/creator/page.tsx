import { redirect } from 'next/navigation';

// The creator portal has no landing page of its own — the dashboard is the root
// of the experience. Unauthenticated visitors are bounced to the login screen by
// CreatorAuthWrapper in the layout, which carries the dashboard as its redirect.
export default function CreatorPortalIndex() {
  redirect('/creator/dashboard');
}
