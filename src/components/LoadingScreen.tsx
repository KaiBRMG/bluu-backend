"use client";

/**
 * Full-screen loading graphic shown while the app boots — during Firebase auth
 * resolution and again while user data + page permissions load. Kept up until the
 * UI is fully ready so the real layout never flashes a half-resolved state.
 */
export default function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <video
        className="w-24 h-24 object-contain"
        src="/loader.webm"
        autoPlay
        muted
        loop
        playsInline
      />
    </div>
  );
}
