import { redirect } from 'next/navigation';

// The creator portal has no landing page of its own — the dashboard is the root
// of the experience. There is nowhere to bounce an unauthenticated visitor to
// any more: CreatorAuthWrapper in the layout signs them in from Telegram's
// `initData`, or explains why it could not, in place.
//
// This is also the URL the bot's chat menu button points at (see
// `setCreatorPortalMenuButton`), so it must keep resolving to the dashboard.
export default function CreatorPortalIndex() {
  redirect('/creator/dashboard');
}
