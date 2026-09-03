import { redirect } from 'next/navigation';

// The creator portal has no landing page of its own — the dashboard is the root
// of the experience. There is nowhere to bounce an unauthenticated visitor to
// any more: CreatorAuthWrapper in the layout signs them in from Telegram's
// `initData`, or explains why it could not, in place.
//
// ⚠️ The bot's chat menu button deliberately does NOT point here — it points
// straight at /creator/dashboard. Telegram launches a Mini App with its signed
// `initData` in a URL *fragment*, and in-app webviews do not reliably re-attach
// a fragment across the redirect below, which loses the whole session. This
// route stays for anyone who types or shares the bare /creator URL.
export default function CreatorPortalIndex() {
  redirect('/creator/dashboard');
}
