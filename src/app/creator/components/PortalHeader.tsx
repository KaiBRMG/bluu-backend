"use client";

import Link from "next/link";
import { ExternalLink, FolderOpen, LogOut } from "lucide-react";
import { auth } from "@/firebase-config";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useCreatorAuth } from "@/components/CreatorAuthProvider";
import { ACCENT_BTN, COLOR, FOCUS_RING, HEADER_STYLE, SURFACE } from "../theme";
import { tapFeedback } from "../lib/haptics";

/**
 * The portal's one top bar.
 *
 * Every page used to hand-roll its own header, which is how the logo ended up
 * absolutely centred on one page and flex-centred on another, and how the Drive
 * link ended up reachable only from the bottom of the dashboard's scroll. One
 * component, four screens.
 *
 * **Drive lives here, not in a section card.** Uploading is the physical act the
 * whole portal is coordinating — a creator finishes filming and needs the folder
 * *now*, from whatever screen she is on. A persistent affordance in the chrome
 * is what that deserves; a card at the bottom of one page is not.
 */
export function PortalHeader({ title }: { title?: string }) {
  const { creatorUser } = useCreatorAuth();
  const driveLink = creatorUser?.driveLink;
  const stageName = creatorUser?.stageName || creatorUser?.displayName || "Creator";

  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center gap-1 px-2 sm:px-4"
      style={HEADER_STYLE}
    >
      <SidebarTrigger
        className={`relative hidden md:inline-flex after:absolute after:-inset-3 after:content-[''] ${FOCUS_RING}`}
        style={{ color: COLOR.ink2 }}
      />

      <Link
        href="/creator/dashboard"
        aria-label="Creator portal home"
        className={`flex h-11 shrink-0 items-center rounded-lg px-2 ${FOCUS_RING}`}
      >
        {/* The logo is the one non-Avatar image in the portal. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/bluu_long.svg" alt="Bluu Rock" className="h-5 w-auto" />
      </Link>

      {title && (
        <>
          <span
            aria-hidden="true"
            className="hidden h-4 w-px shrink-0 sm:block"
            style={{ background: COLOR.line }}
          />
          <span
            className="hidden truncate text-sm font-medium sm:block"
            style={{ color: COLOR.ink2 }}
          >
            {title}
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        {driveLink && (
          <a
            href={driveLink}
            target="_blank"
            rel="noreferrer"
            onClick={() => tapFeedback()}
            className={`inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors ${ACCENT_BTN} ${FOCUS_RING}`}
          >
            <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
            {/* Below `sm` the label is dropped so the logo, Drive and the
                account control still fit a 320px screen without wrapping; the
                accessible name comes from the sr-only span either way. */}
            <span className="hidden sm:inline" aria-hidden="true">
              Drive
            </span>
            <span className="sr-only">Open your Google Drive folder</span>
          </a>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className={`h-11 items-center gap-2 rounded-xl px-2 hover:bg-[#1e2934] ${FOCUS_RING}`}
              aria-label="Account"
            >
              <Avatar size="sm" className="ring-1 ring-[#293440]">
                {creatorUser?.photoURL && <AvatarImage src={creatorUser.photoURL} alt="" />}
                <AvatarFallback
                  style={{ background: `${COLOR.azure}2b`, color: COLOR.azureSoft }}
                  className="text-xs font-semibold"
                >
                  {stageName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span
                className="hidden max-w-[8rem] truncate text-sm font-medium sm:block"
                style={{ color: COLOR.ink }}
              >
                {stageName}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className={`w-60 overflow-hidden rounded-xl p-0 ${SURFACE.overlay}`}
          >
            <div className="border-b px-4 py-3" style={{ borderColor: COLOR.line }}>
              <p className="truncate text-sm font-semibold" style={{ color: COLOR.ink }}>
                {stageName}
              </p>
              <p className="mt-0.5 truncate text-xs" style={{ color: COLOR.ink2 }}>
                {creatorUser?.userEmail}
              </p>
            </div>
            <div className="p-1.5">
              {driveLink && (
                <a
                  href={driveLink}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex h-11 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors hover:bg-[#1e2934] ${FOCUS_RING}`}
                  style={{ color: COLOR.ink2 }}
                >
                  <FolderOpen className="size-4" aria-hidden="true" />
                  Google Drive folder
                  <ExternalLink className="ml-auto size-3.5" aria-hidden="true" />
                </a>
              )}
              <Button
                variant="ghost"
                className={`h-11 w-full justify-start gap-2.5 rounded-lg px-3 text-sm hover:bg-[#1e2934] ${FOCUS_RING}`}
                style={{ color: COLOR.ink2 }}
                onClick={() => auth.signOut()}
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
