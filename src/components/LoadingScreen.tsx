"use client";

/**
 * Full-screen loading graphic shown while the app boots — during Firebase auth
 * resolution and again while user data, page permissions, and the home widgets'
 * data load. Rendered as a fixed overlay (z above the sidebar/top bar) so the
 * real layout can mount and fetch underneath while this stays on top, keeping the
 * UI from flashing a half-resolved state.
 */
export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black">
      <video
        className="w-24 h-24 object-contain"
        src="/loader.webm"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
    </div>
  );
}
