'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";

export default function NoConnectionModal() {
  return (
    <Dialog open>
      <DialogContent showCloseButton={false} className="max-w-sm text-center">
        <DialogHeader className="items-center">
          <div className="mb-2 flex justify-center" style={{ color: 'var(--foreground-secondary)' }}>
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 1l22 22" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
          </div>
          <DialogTitle>No Internet Connection</DialogTitle>
          <DialogDescription>
            You are currently offline. Please check your internet connection to continue using the app.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--foreground-secondary)' }}>
          <Loader />
          <span>Attempting to reconnect...</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
