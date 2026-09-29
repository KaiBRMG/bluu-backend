# Product

<!-- impeccable:product-schema 1 -->

> Written 2026-09-28 from repository evidence (CLAUDE.md, `documentation/`, DESIGN.md) during the creator-onboarding build. The facts below are **inferred from the codebase, not confirmed in an interview** — correct anything that is wrong rather than working around it.

## Platform

web

## Users

- **Internal staff of Bluu Rock MGMT** (a talent management agency for adult-content creators) — chat agents, social-media managers, admins. They live inside the Electron desktop console for whole shifts: clocked in, working queues, reviewing records.
- **Creators** — the agency's signed talent. Reach the product only through the Telegram Mini App at `/creator`, almost always on a phone, to see what they owe and what is late.
- **Prospective creators (applicants)** — strangers who enquired by email to `hello@bluurock.com` or were handed a link. They meet the brand on public pages (`/model-submissions`, and after approval the personalised onboarding link), in a normal phone browser, once, deciding whether to trust the agency with personal details and photos.

## Product Purpose

An internal management platform that runs the agency: time tracking, chat-agent salary and coverage, custom-request and content-planning pipelines, social growth tracking, and the recruiting funnel that brings new creators in. Success is staff doing their work inside one console without spreadsheets, and a recruiting funnel that turns an email enquiry into an onboarded creator with no manual copy-paste.

## Positioning

Bluu Rock is a hands-on management agency, not a self-serve platform: every application is reviewed by a person, and the onboarding answers become the brief the chat team works from (content limits, the persona chatters play).

## Operating Context

- Enquiries arrive at `hello@bluurock.com` (Google Workspace), including a website contact form relayed through the web host.
- Applicants apply on `/model-submissions`; staff approve or reject in Creator Portal → Model Submissions; approved applicants are emailed a personal onboarding link.
- Real conversations with creators happen on Telegram (and WhatsApp); a Telegram handle is what staff need to take a relationship forward.

## Capabilities and Constraints

- Next.js 16 App Router + Firebase (Firestore/Storage via Admin SDK) on Vercel; Electron wraps the internal console.
- Public, unauthenticated surfaces are browser-allowlisted in `src/middleware.ts`; everything else is desktop-only.
- Applicant data is the most sensitive data held; client Firestore access to it is denied outright.
- Email is sent through Resend from `hello@bluurock.com`.

## Brand Commitments

- Name: **Bluu Rock** (styled `BLUU ROCK` in the welcome email subject). Logo lockup `/logo/HQ2.webp`, white-inked, dark grounds only.
- Bluu azure `#00b8f5` is the one brand voice on public surfaces.
- Voice to applicants: warm, direct, confidential. "All information is confidential and is never shared externally."

## Evidence on Hand

- No testimonials, acceptance rates, creator earnings or roster size exist in the repo. **Do not invent any of them** on public pages; exclusivity must come from true facts (hand review, personal invitation), not fabricated numbers.

## Product Principles

1. Never lose an applicant's work — a long form saves as it goes.
2. Confidential by default: collect only what the chat team will use, show it only to staff with the page permission.
3. One console, one visual language internally; public surfaces may be louder, never dishonest.
4. Automate the repetitive (replies, invites) and keep a human on every judgement (approval, spam false-positives).

## Accessibility & Inclusion

- Public forms are read on phones by an international audience: 16px field text, ≥44px targets, browser translation disabled on form routes (it crashed React).
- AA contrast is measured, not assumed (DESIGN.md records the figures).
