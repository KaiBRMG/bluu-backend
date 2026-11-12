import type { Metadata } from 'next';
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/terms';

export const metadata: Metadata = {
  title: 'Terms of Use & Privacy Policy · Bluu Rock MGMT',
  description:
    'Terms of use and privacy policy for Bluu Rock staff, creators, applicants, training candidates and other visitors.',
};

/**
 * The published legal document for every Bluu Rock surface.
 *
 * This page is the SINGLE SOURCE OF RECORD. It is deliberately one document
 * covering every audience (staff, creators, and external individuals —
 * applicants, onboarding recruits, training candidates, enquirers and the
 * recipients of shared links) rather than several, because separate documents
 * drift apart and a user cannot tell which one binds them. Part A binds
 * everyone; Part B adds the staff-only monitoring terms; Part C adds the
 * creator terms; Part D is the privacy policy and applies to everyone; Part E
 * adds the terms for people who use a public page with no account.
 *
 * Part E is APPENDED after the privacy policy rather than inserted before it,
 * on purpose: other surfaces cite "Part B", "Part C" and "Part D" by letter
 * (the staff welcome step, the creator welcome page, the docs), and a new
 * audience must not silently re-point them. Clause numbers are cited the same
 * way — add new clauses at the end, do not renumber.
 *
 * It is reachable from: the internal Login screen, onboarding step 1
 * (`/onboarding/welcome`, where acceptance is recorded as `hasAcceptedTerms`),
 * the creator welcome page, and the model application form's submit step.
 * `/terms` is allowlisted in `src/middleware.ts` so it resolves outside
 * Electron. `/training` and `/join/[token]` do NOT link here yet.
 *
 * RULE — bump `TERMS_VERSION` and `TERMS_EFFECTIVE_DATE` (in `lib/terms.ts`)
 * together on any substantive edit. **A bump signs every employee out** once
 * they are clocked out and inactive, and signing back in is their acceptance
 * (`users/{uid}.acceptedTermsVersion` records which version). So do not bump for
 * a typo.
 */

// Declared in lib/terms.ts so the sign-out mechanism and this page can never
// disagree. Bumping TERMS_VERSION signs the whole organisation out (once, after
// a period of inactivity, while clocked out) — see that file.
const EFFECTIVE_DATE = TERMS_EFFECTIVE_DATE;
const VERSION = TERMS_VERSION;
const CONTACT_EMAIL = 'kai@bluurock.com';

const HAIRLINE = 'rgba(255,255,255,0.07)';

/** A top-level part of the document, with its audience stated up front. */
function Part({
  id,
  letter,
  title,
  audience,
  children,
}: {
  id: string;
  letter: string;
  title: string;
  audience: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-16 scroll-mt-8 border-t pt-10" style={{ borderColor: HAIRLINE }}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
        Part {letter}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-balance text-white">{title}</h2>
      <p
        className="mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed text-zinc-400"
        style={{ background: 'rgba(255,255,255,0.025)', borderColor: HAIRLINE }}
      >
        <strong className="font-semibold text-white">Applies to:</strong> {audience}
      </p>
      {children}
    </section>
  );
}

/** A numbered clause of the agreement. */
function Clause({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h3 className="text-lg font-semibold text-white">
        <span className="mr-2 tabular-nums text-zinc-500">{n}.</span>
        {title}
      </h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** A defined term followed by its explanation. */
function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-sm leading-relaxed text-zinc-400">
      <strong className="font-semibold text-white">{label}</strong> {children}
    </p>
  );
}

/** Ordinary body copy inside a clause. */
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-zinc-400">{children}</p>;
}

/** A bulleted list of obligations or items. */
function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="space-y-2 pl-5 text-sm leading-relaxed text-zinc-400">{children}</ul>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <li className="list-disc marker:text-zinc-600">{children}</li>;
}

/** Emphasised inline text. Used for defined terms and for load-bearing words. */
function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-white">{children}</strong>;
}

/** A two-column data table, used for the lawful-basis and provider schedules. */
function DataTable({
  head,
  rows,
}: {
  head: [string, string];
  rows: [string, string][];
}) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <thead>
          <tr>
            <th
              className="border-b py-2 pr-4 text-xs font-semibold uppercase tracking-wider text-zinc-500"
              style={{ borderColor: HAIRLINE }}
            >
              {head[0]}
            </th>
            <th
              className="border-b py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500"
              style={{ borderColor: HAIRLINE }}
            >
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a}>
              <td
                className="border-b py-2.5 pr-4 align-top font-medium text-zinc-200"
                style={{ borderColor: HAIRLINE }}
              >
                {a}
              </td>
              <td
                className="border-b py-2.5 align-top leading-relaxed text-zinc-400"
                style={{ borderColor: HAIRLINE }}
              >
                {b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CONTENTS: { id: string; label: string; note: string }[] = [
  { id: 'part-a', label: 'Part A — Terms of Use', note: 'Everyone' },
  { id: 'part-b', label: 'Part B — Staff & Bluu Backend', note: 'Employees and contractors' },
  { id: 'part-c', label: 'Part C — Creator Portal', note: 'Creators and clients' },
  { id: 'part-d', label: 'Part D — Privacy Policy', note: 'Everyone' },
  {
    id: 'part-e',
    label: 'Part E — Applicants, Candidates and Other Visitors',
    note: 'People using a public page without an account',
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <article className="mx-auto w-full max-w-[68ch]">
        <header className="border-b pb-8" style={{ borderColor: HAIRLINE }}>
          <h1 className="text-2xl font-semibold text-balance text-white">
            Bluu Rock MGMT — Terms of Use &amp; Privacy Policy
          </h1>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1.5 text-xs text-zinc-400">
            <div className="flex gap-2">
              <dt className="text-zinc-500">Effective date</dt>
              <dd className="tabular-nums">{EFFECTIVE_DATE}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Version</dt>
              <dd className="tabular-nums">{VERSION}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Owner</dt>
              <dd>Bluu Rock MGMT</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Contact</dt>
              <dd>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="underline underline-offset-2 transition-colors hover:text-white"
                >
                  {CONTACT_EMAIL}
                </a>
              </dd>
            </div>
          </dl>
        </header>

        <p className="mt-8 text-sm leading-relaxed text-pretty text-zinc-400">
          This document is the agreement between <B>Bluu Rock MGMT</B> (&ldquo;Bluu Rock&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;) and you, and it is also our privacy policy. It
          governs the surfaces below, and who each one is for:
        </p>
        <List>
          <Item>
            <B>Bluu Backend</B> — the internal desktop application used by Bluu Rock employees
            and contractors.
          </Item>
          <Item>
            <B>The Creator Portal</B> — the app that opens inside our Telegram bot, used by the
            creators and clients whose accounts we manage.
          </Item>
          <Item>
            <B>Our public pages</B> — the model application form, the personal onboarding form
            we send to approved applicants, the training and trial-test pages for candidates, the
            hello@bluurock.com enquiry address, and the links our team shares with people outside
            the company. You do not need an account to use these.
          </Item>
        </List>
        <p className="mt-3 text-sm leading-relaxed text-pretty text-zinc-400">
          Together these are the <B>&ldquo;Services&rdquo;</B>. Read the part that applies to you
          alongside <B>Part A</B> and <B>Part D</B>, which apply to everyone: staff read Part B,
          creators and clients read Part C, and anyone using a public page without an account —
          applicants, people we have invited to onboard, training candidates and enquirers — reads{' '}
          <B>Part E</B>. By creating an account, signing in, submitting a form, taking a test, or
          otherwise using any of the Services, you agree to this document. If you do not agree, do
          not use the Services.
        </p>

        {/* ── Contents ─────────────────────────────────────────────────── */}
        <nav
          aria-label="Contents"
          className="mt-8 rounded-xl border p-5"
          style={{ background: 'rgba(255,255,255,0.025)', borderColor: HAIRLINE }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Contents
          </p>
          <ul className="mt-3 space-y-2">
            {CONTENTS.map(({ id, label, note }) => (
              <li key={id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <a
                  href={`#${id}`}
                  className="text-sm text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
                >
                  {label}
                </a>
                <span className="text-xs text-zinc-500">{note}</span>
              </li>
            ))}
          </ul>
        </nav>

        {/* ═══ PART A ═══════════════════════════════════════════════════ */}
        <Part
          id="part-a"
          letter="A"
          title="Terms of Use"
          audience="Every user of every Bluu Rock service — staff, creators, clients, applicants, training candidates and anyone else who uses a Bluu Rock page or link."
        >
          <Clause n={1} title="Acceptance and Changes">
            <Term label="Agreement:">
              By accessing or using the Services you accept this document in full, on your own
              behalf and on behalf of any organisation you use the Services for.
            </Term>
            <Term label="Changes:">
              We may update this document. The current version is always published at{' '}
              <span className="text-zinc-300">/terms</span> with its version number and effective
              date. Where a change materially affects your rights, we will give notice in the
              application or by email before it takes effect. Continued use after the effective
              date is acceptance of the updated version.
            </Term>
            <Term label="Other agreements:">
              If you have signed a separate written agreement with Bluu Rock — an employment
              contract, a contractor agreement, or a management agreement — and it conflicts with
              this document, <B>that signed agreement prevails</B> for the subject matter it
              covers. This document governs your use of the software.
            </Term>
          </Clause>

          <Clause n={2} title="Accounts and Access">
            <Term label="Authorised access only:">
              The Services are proprietary tools. Access is limited to active employees,
              contractors, creators, clients and other persons expressly authorised by Bluu Rock —
              which includes the applicants, candidates and invitees who use the public pages
              described in Part E, for the limited purpose each page is built for.
            </Term>
            <Term label="No self-registration:">
              Accounts are created by an administrator. Until an administrator has registered your
              address (or, for creators, linked your Telegram account), sign-in is refused. If
              your sign-in is blocked, contact your team leader or account manager. The public
              pages in Part E need no account, and using them does not create one.
            </Term>
            <Term label="One person, one account:">
              Your account is personal to you. Do not share it, do not let another person use your
              session, and do not use anyone else&rsquo;s account. You are responsible for
              everything done through your account.
            </Term>
            <Term label="Credential security:">
              Keep your credentials confidential, use a strong and unique password, and enable
              two-factor authentication where the sign-in method supports it. Tell us immediately
              at{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-white underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              if you believe your account has been compromised.
            </Term>
            <Term label="Suspension and termination:">
              We may suspend or terminate access at any time — immediately and without notice
              where we reasonably suspect a breach of this document, a security risk, or unlawful
              activity — and automatically when your employment, contract or management
              relationship with Bluu Rock ends.
            </Term>
          </Clause>

          <Clause n={3} title="Acceptable Use">
            <P>
              You agree <B>not</B> to:
            </P>
            <List>
              <Item>
                Use the Services for any personal, illegal, fraudulent or unauthorised purpose.
              </Item>
              <Item>
                Attempt to reverse-engineer, decompile, probe, scan or bypass any security
                control, permission boundary or rate limit of the Services.
              </Item>
              <Item>
                Access data, pages or accounts you have not been granted access to, or attempt to
                escalate your own permissions.
              </Item>
              <Item>
                Upload, transmit or introduce malicious software, code or automated agents into
                any Bluu Rock environment.
              </Item>
              <Item>
                Scrape, bulk-export, copy or republish data from the Services except as your role
                expressly requires.
              </Item>
              <Item>
                Upload or submit any content that is unlawful, that infringes another
                person&rsquo;s rights, that depicts any person under 18, or that depicts any
                person who has not consented to its creation and distribution.
              </Item>
              <Item>
                Use the Services in a way that breaches the terms of any third-party platform we
                integrate with, or any applicable law, sanctions regime or export control.
              </Item>
            </List>
            <Term label="Enforcement:">
              We may investigate suspected breaches, preserve relevant records, restrict access,
              and report unlawful activity to the authorities.
            </Term>
          </Clause>

          <Clause n={4} title="Intellectual Property and Confidentiality">
            <Term label="Our property:">
              All software, code, architecture, design, documentation, workflows and aggregated
              data within the Services are the property of Bluu Rock or its licensors. Nothing in
              this document transfers any ownership to you. You receive a limited, revocable,
              non-transferable right to use the Services for their intended purpose while
              authorised.
            </Term>
            <Term label="Your content:">
              Content you upload or supply remains yours. You grant Bluu Rock the licence
              described in clause 17 (creators), the limited use described in clauses 30 and 32
              (applicants and candidates), or, for staff, the rights already granted under your
              employment or contractor agreement.
            </Term>
            <Term label="Confidentiality:">
              Everything you see in the Services that is not public — fan data, earnings figures,
              content plans, strategy, other users&rsquo; personal data, credentials, internal
              documentation — is confidential. Do not disclose it, copy it outside the Services,
              or use it for any purpose other than performing your role or managing your own
              account. This obligation survives the end of your access.
            </Term>
          </Clause>

          <Clause n={5} title="Availability, Warranties and Third-Party Services">
            <Term label="&ldquo;As-is&rdquo; basis:">
              The Services are provided on an <B>&ldquo;as-is&rdquo;</B> and{' '}
              <B>&ldquo;as-available&rdquo;</B> basis. To the fullest extent permitted by law we
              make no warranties, express or implied, including any implied warranties of
              merchantability, fitness for a particular purpose, accuracy or non-infringement, and
              we do not warrant that the Services will be uninterrupted, timely, secure or
              error-free.
            </Term>
            <Term label="No guarantee of results:">
              Nothing in the Services is a promise, projection or guarantee of earnings,
              performance, growth or commercial outcome. Figures displayed are operational
              tracking data, not financial statements or advice.
            </Term>
            <Term label="Third-party services:">
              The Services depend on third parties (see clause 25). We are not responsible for
              their availability, acts or omissions, and links or integrations to third-party
              services are not an endorsement. Your use of those services is governed by their own
              terms.
            </Term>
            <Term label="Data loss:">
              While we use hosted infrastructure with backups, we are not liable for loss of data
              or work caused by system timeouts, hardware failure, connectivity issues, or your
              own device. Do not rely on the Services as your only copy of anything important.
            </Term>
          </Clause>

          <Clause n={6} title="Limitation of Liability">
            <Term label="Nothing excluded that cannot be:">
              Nothing in this document limits or excludes liability for death or personal injury
              caused by negligence, for fraud or fraudulent misrepresentation, or for any other
              liability that cannot lawfully be limited or excluded. Nothing here affects any
              statutory employment right.
            </Term>
            <Term label="Excluded losses:">
              Subject to the paragraph above, Bluu Rock is not liable for any indirect, special or
              consequential loss, or for loss of profit, revenue, business, goodwill, anticipated
              savings, or data, however caused.
            </Term>
            <Term label="Cap:">
              Subject to the first paragraph of this clause, Bluu Rock&rsquo;s total aggregate
              liability arising out of or in connection with the Services in any twelve-month
              period is limited to the greater of (a) the total amount you paid Bluu Rock for
              access to the Services in that period, and (b) £100.
            </Term>
            <Term label="Allocation of risk:">
              These limits reflect the fact that the Services are supplied as internal operational
              tooling rather than as a paid software product, and apply to claims in contract,
              tort (including negligence), breach of statutory duty or otherwise.
            </Term>
          </Clause>

          <Clause n={7} title="Indemnity">
            <P>
              You will indemnify and hold Bluu Rock harmless against any claim, loss, liability or
              reasonable cost (including legal fees) arising from your breach of this document,
              your unlawful use of the Services, or content you supply that infringes a third
              party&rsquo;s rights or breaches any law. This clause does not apply to an employee
              acting within the proper scope of their employment.
            </P>
          </Clause>

          <Clause n={8} title="Governing Law and Disputes">
            <Term label="Governing law:">
              This document and any dispute arising out of it or the Services (including
              non-contractual disputes) are governed by the laws of{' '}
              <B>England and Wales</B>.
            </Term>
            <Term label="Jurisdiction:">
              The courts of England and Wales have exclusive jurisdiction, save that Bluu Rock may
              seek injunctive relief in any competent court to protect its confidential
              information or intellectual property.
            </Term>
            <Term label="Raise it with us first:">
              Before starting proceedings, please contact us at{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-white underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              so we can try to resolve the matter directly.
            </Term>
          </Clause>

          <Clause n={9} title="General">
            <Term label="Severability:">
              If any provision is held unenforceable, it is severed and the remainder continues in
              force.
            </Term>
            <Term label="No waiver:">
              A failure to enforce any provision is not a waiver of it.
            </Term>
            <Term label="Assignment:">
              You may not assign your rights under this document. We may assign ours to an
              affiliate or in connection with a merger, acquisition or sale of assets.
            </Term>
            <Term label="Third parties:">
              A person who is not a party to this document has no right to enforce it under the
              Contracts (Rights of Third Parties) Act 1999.
            </Term>
            <Term label="Notices:">
              Notices to Bluu Rock go to{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-white underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>
              . Notices to you go to the address on your account or are shown in the application.
            </Term>
            <Term label="Entire agreement:">
              This document, together with any signed agreement referred to in clause 1, is the
              entire agreement between us regarding the Services.
            </Term>
          </Clause>
        </Part>

        {/* ═══ PART B ═══════════════════════════════════════════════════ */}
        <Part
          id="part-b"
          letter="B"
          title="Staff — Bluu Backend and Workplace Monitoring"
          audience="Bluu Rock employees and contractors using the Bluu Backend desktop application. Creators and clients can skip to Part C; applicants, candidates and other visitors to Part E."
        >
          <Clause n={10} title="Company Time and “Clocked In”">
            <Term label="Definition:">
              <B>&ldquo;Clocked In&rdquo;</B> means any period in which you have explicitly
              activated the time-tracking feature, including time recorded as a break where the
              application records it. Time recorded in this state is classified as company time
              and is eligible for billing.
            </Term>
            <Term label="Accuracy is your responsibility:">
              Clock in only when you are working, and clock out when you stop. Falsifying recorded
              time — including leaving a session running while not working, or automating activity
              to appear active — is a serious breach of this document and of your engagement.
            </Term>
            <Term label="What clocking in authorises:">
              By clocking in you acknowledge and authorise the monitoring described in clause 11
              for the duration of that session.
            </Term>
          </Clause>

          <Clause n={11} title="Workplace Monitoring">
            <P>
              To verify recorded time, ensure project accuracy, protect company and creator data,
              and maintain quality, Bluu Backend includes automated monitoring. We are transparent
              about its scope, and we keep it to what is necessary for those purposes.
            </P>
            <Term label="When monitoring is active:">
              Monitoring runs <B>only while you are Clocked In</B>. It does not run when you are
              clocked out, and it does not run when the application is closed.
            </Term>
            <Term label="Screenshot capture:">
              While Clocked In, the application captures screenshots of your screen(s) at
              randomised intervals, on average around every 15 minutes. If you have system
              notifications enabled, your device notifies you each time a screenshot is
              successfully captured.
            </Term>
            <Term label="Other monitoring data:">
              While Clocked In we also record session start and end times, break periods, an
              activity percentage derived from whether input is occurring, the page you are on
              within the application, and technical diagnostics such as application version,
              operating system and crash reports. Where an administrator has switched on input
              monitoring, the application also records <B>when</B> keys are pressed and what{' '}
              <B>kind</B> they are (typing, a modifier such as Shift, or a filler key) — never
              which key — and compares each screenshot with the last to spot a screen that is not
              changing. These signals are used only to prompt an administrator to take a closer
              look; they do not change your recorded time or pay.
            </Term>
            <Term label="What we do NOT do:">
              We do not log keystrokes or capture what you type. We do not access your camera.
              We do not read your files, your browsing history, your email, or any
              other application&rsquo;s data. We do not track your physical location. We do not
              monitor you outside a Clocked In session.{' '}
              <strong className="font-semibold text-zinc-200">
                Your microphone is never part of monitoring.
              </strong>{' '}
              It is used in one place only: the Snipping Tool, when you yourself turn the
              Microphone option on to narrate a screen recording you are choosing to make.
              It is off by default, it is never opened while you are simply Clocked In, and
              your operating system shows its own recording indicator whenever it is live.
            </Term>
            <Term label="Access and storage:">
              Monitoring data is stored in our private, access-controlled infrastructure,
              encrypted in transit and at rest by our hosting providers, and is treated as
              confidential company data. Access is limited to the small number of administrators
              whose role requires it.
            </Term>
            <Term label="No external sharing:">
              Screenshots and monitoring data are used solely for internal management, payroll and
              billing verification, auditing, security and quality assurance. We do not sell them
              and we do not disclose them to third parties, except to the service providers who
              host our systems on our behalf (clause 25) and where we are required to by law.
            </Term>
            <Term label="Protecting your privacy:">
              Close personal windows, applications and messages before you clock in, and prefer a
              work profile or work device. If a screenshot inadvertently captures sensitive
              personal information — banking, health, a private message — tell an administrator or
              email{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-white underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              and we will delete that capture. We will not refuse a reasonable request of this
              kind.
            </Term>
            <Term label="Your expectation of privacy:">
              While Clocked In on a company tool you should expect that on-screen activity may be
              recorded as described above. Outside those sessions, your device and your time are
              your own.
            </Term>
            <Term label="Lawful basis and your rights:">
              Where UK or EU data protection law applies, this monitoring is carried out for our
              legitimate interests in verifying billable time and protecting our systems and our
              creators&rsquo; data, and for the performance of your contract. You have the right
              to object to processing based on legitimate interests, to see the monitoring data we
              hold about you, and to request correction or deletion. See Part D.
            </Term>
          </Clause>

          <Clause n={12} title="Sign-In with a Personal Google Account">
            <Term label="How sign-in works:">
              Bluu Backend uses Google sign-in with your own personal Google account. Because that
              account is the key to company systems and creator data, you are responsible for
              keeping it secure — a strong, unique password, two-factor authentication, and never
              leaving it signed in on a device others can use.
            </Term>
            <Term label="What Google shares with us:">
              When you sign in, Bluu Rock receives only your{' '}
              <B>name, email address, and profile picture</B>. We do not request, receive or have
              any access to your Gmail, Drive, Photos, contacts or any other content in your
              Google account, and we cannot act on your behalf within it. Using a personal account
              to sign in does not give Bluu Rock access to your personal data.
            </Term>
            <Term label="Changing your sign-in address:">
              Your sign-in address may only be changed through the application or by an
              administrator. Once changed, the previous address no longer grants access.
            </Term>
          </Clause>

          <Clause n={13} title="Devices, Sessions and Software">
            <Term label="Desktop application:">
              Bluu Backend is distributed as a desktop application. You must install it only from
              the download page we provide, and you must install updates when prompted —
              particularly updates marked as required, which may block access until installed.
            </Term>
            <Term label="Device sessions:">
              Sessions are recorded per device. Signing in on a second desktop machine ends the
              session on the first, because no one should be clocked in on two machines at once.
              We may revoke any session at any time.
            </Term>
            <Term label="Your own device:">
              If you install Bluu Backend on a personal device, clause 11 still describes exactly
              what is captured and when. If you prefer that your personal device is never
              screenshotted, do not clock in on it.
            </Term>
          </Clause>

          <Clause n={14} title="End of Engagement">
            <Term label="Access revoked:">
              When your employment or contract ends, access is revoked immediately and your
              address is removed from the system. Your personal Google account remains your own
              and is unaffected.
            </Term>
            <Term label="Return and deletion:">
              You must return or delete any company or creator data held outside the Services. Your
              confidentiality obligations under clause 4 continue after your access ends.
            </Term>
          </Clause>
        </Part>

        {/* ═══ PART C ═══════════════════════════════════════════════════ */}
        <Part
          id="part-c"
          letter="C"
          title="Creators and Clients — The Creator Portal"
          audience="Creators and clients whose accounts Bluu Rock manages, using the Creator Portal in Telegram. People who have only applied or been invited to onboard — and have not yet signed a management agreement — are covered by Part E."
        >
          <Clause n={15} title="What the Creator Portal Is">
            <Term label="A coordination tool:">
              The Creator Portal is the workspace where you and the Bluu Rock team coordinate:
              custom requests, calls and items ordered by fans; your content plan and its due
              dates; completion status; and the upload link for the content you record.
            </Term>
            <Term label="It is not your management agreement:">
              The Portal records operational information only. Your commercial relationship with
              Bluu Rock — services, commission, payment terms, term and termination — is governed
              exclusively by your signed management agreement. Where the Portal and that agreement
              differ, <B>the signed agreement prevails</B>.
            </Term>
            <Term label="Figures shown are tracking data:">
              Amounts, totals and paid/outstanding values shown in the Portal are internal
              tracking figures maintained for coordination. They are <B>not</B> a statement of
              account, an invoice, a payment confirmation, or a promise of payment, and they may
              be incomplete, provisional or corrected later. Payments are made and reconciled
              under your management agreement.
            </Term>
          </Clause>

          <Clause n={16} title="Your Account and Eligibility">
            <Term label="Account creation:">
              Your Portal account is created for you by a Bluu Rock administrator, who links it
              to your Telegram account. There is no separate username or password.
            </Term>
            <Term label="Signing in with Telegram:">
              The Portal opens only inside Telegram, through our bot. When it opens, Telegram
              gives us a signed confirmation of who you are, and we check it against the Telegram
              account an administrator linked to your Portal account. We receive your Telegram
              user ID and the basic profile details Telegram includes with that confirmation. We
              do not read your other chats, your contacts or your messages with anyone else.
            </Term>
            <Term label="Keep it yours:">
              Your Telegram account is the key to your Portal account. Keep it secure (enable
              Telegram&rsquo;s own two-step verification), never let another person use it or the
              Portal on your behalf — including an assistant, partner or agency — without our
              written agreement, and tell us at once if you lose access to it or change your
              number.
            </Term>
            <Term label="Age and capacity:">
              You confirm that you are at least <B>18 years old</B> and have the legal capacity to
              enter this agreement. The Services are not available to anyone under 18.
            </Term>
            <Term label="Accuracy:">
              Keep the information on your account accurate, and tell us promptly when it changes.
            </Term>
            <Term label="Deactivation:">
              We may deactivate your Portal account when the management relationship ends, or
              immediately in the circumstances in clause 2. Deactivation removes access to the
              Portal; it does not by itself end your management agreement.
            </Term>
          </Clause>

          <Clause n={17} title="Your Content">
            <Term label="You keep ownership:">
              You retain all ownership and intellectual property rights in the photographs,
              videos, audio, messages and other material you create and supply
              (&ldquo;Creator Content&rdquo;).
            </Term>
            <Term label="Licence to us:">
              You grant Bluu Rock a non-exclusive, worldwide, royalty-free licence, for as long as
              your management agreement is in force, to store, reproduce, edit, caption, schedule,
              publish, distribute, promote and monetise Creator Content on the platforms and
              channels we manage for you, and to use it internally for the operation of those
              accounts. This licence exists so we can perform the management services you have
              engaged us for; it grants no rights beyond that purpose, and it is subject to any
              narrower terms in your signed management agreement.
            </Term>
            <Term label="Your warranties:">
              For all Creator Content you supply, you confirm that:
            </Term>
            <List>
              <Item>
                every person appearing in it was at least <B>18 years old</B> at the time of
                creation, and you hold or can produce records evidencing that;
              </Item>
              <Item>
                every person appearing in it has given informed, documented consent to its
                creation and to its distribution and monetisation on the relevant platforms;
              </Item>
              <Item>
                you own or have secured all rights, releases and licences necessary — including
                for any music, footage, artwork, trademark or location shown; and
              </Item>
              <Item>
                it is lawful in your jurisdiction, complies with the rules of the platforms it
                will be published on, and does not infringe anyone&rsquo;s rights.
              </Item>
            </List>
            <Term label="Removal:">
              We may refuse, remove or stop distributing any content we reasonably believe
              breaches these warranties, any platform rule, or any law — without that refusal
              being a breach by us.
            </Term>
            <Term label="Uploads via Google Drive:">
              Content is delivered to us through a Google Drive link we provide. Google Drive is
              operated by Google under its own terms and privacy policy. Anyone holding a share
              link to a folder can access it, so treat your link as confidential, and do not place
              anything in that folder you do not intend to hand to us.
            </Term>
          </Clause>

          <Clause n={18} title="How We Operate Your Account">
            <Term label="Acting on your behalf:">
              Where your management agreement provides for it, Bluu Rock team members access,
              message from, and operate the platform accounts we manage for you — including
              messaging fans, sending and pricing content, and running campaigns. In doing so we
              handle fan communications and related information on your behalf.
            </Term>
            <Term label="Requests and due dates:">
              Custom requests and content plan items shown in the Portal carry due dates. Marking
              an item complete is a statement by you that the work has been delivered; our team
              relies on it to release content and to respond to fans. Due dates are evaluated in
              the timezone recorded on your account, which is detected from the device you sign in
              on (see Part D).
            </Term>
            <Term label="Notifications:">
              We may message you through the Bluu Rock Telegram bot to alert you to new or overdue
              items. You can mute or stop the bot in Telegram at any time; doing so does not
              change what you owe us under your management agreement.
            </Term>
            <Term label="No guarantee:">
              We will apply reasonable skill and care, but we do not guarantee any level of
              earnings, subscriber growth, fan response or platform outcome. Platforms may change
              their rules, fees or availability at any time, and we are not responsible for their
              decisions about your account.
            </Term>
          </Clause>
        </Part>

        {/* ═══ PART D ═══════════════════════════════════════════════════ */}
        <Part
          id="part-d"
          letter="D"
          title="Privacy Policy"
          audience="Everyone whose personal data Bluu Rock handles through the Services — staff, creators, clients, applicants, training candidates, enquirers and people who open a link we share."
        >
          <Clause n={19} title="Who Is Responsible for Your Data">
            <P>
              Bluu Rock MGMT is the controller of the personal data described in this Part. For
              any privacy question, request or complaint, contact{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-white underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </P>
            <P>
              Where we operate a creator&rsquo;s platform accounts on their behalf, we act as a{' '}
              <B>processor</B> for the fan communications and platform data we handle in the
              course of those services, on the creator&rsquo;s instructions.
            </P>
          </Clause>

          <Clause n={20} title="What We Collect">
            <Term label="Staff (Bluu Backend):">
              Name, nickname, work email address, profile picture, group and page permissions,
              date of birth and personal details you enter during onboarding, sign-in records,
              device identifiers and session records, time-tracking sessions and breaks, activity
              percentages, screenshots captured while Clocked In, notifications and in-app
              actions, and technical diagnostics including crash and error reports.
            </Term>
            <Term label="Creators and clients (Creator Portal):">
              Name, stage name, email address, profile picture, creator ID, account status, your
              Telegram user ID, your detected timezone, your upload link, and the operational
              records associated with your account — custom requests and campaigns, content plan
              items, due dates, statuses and completion timestamps, tracking amounts, and comments
              entered by you or by our team.
            </Term>
            <Term label="Fan-related information:">
              In the course of managing creator accounts we handle information about fans —
              display names, profile links, message content, purchase and request details. This is
              handled on the creator&rsquo;s behalf and is treated as confidential.
            </Term>
            <Term label="Applicants (model application form):">
              Your name, email address, WhatsApp number and/or Telegram handle, age, country and
              city, sexual orientation, social media pages, whether you have an OnlyFans account
              (and, if so, your trial link and earnings screenshots), and the photographs you
              upload — selfies and body photos. We also keep a one-way hashed form of your IP
              address for abuse limits.
            </Term>
            <Term label="Recruits (personal onboarding form):">
              If we approve your application and send you a personal onboarding link, the answers
              you give there — including your date of birth, location, social pages, equipment,
              availability, earnings history and goals, the kinds of content you will and will not
              make, and details of the persona you would present (age, sex, sexual orientation,
              location, personality and interests) — together with your progress through the form.
              Answers are saved as you type, before you press send.
            </Term>
            <Term label="Enquirers (hello@bluurock.com):">
              The sender, subject and an excerpt of each email we receive, how our automated
              triage classified it, and whether an automatic or personal reply was sent.
            </Term>
            <Term label="Training candidates:">
              Your email address and name, the one-time sign-in codes we send you (stored only in
              hashed form), your timed attempts and their start and finish times, the files and
              written answers you submit, the still image taken by the screen check, and the{' '}
              <B>screen recording</B> of each attempt described in clause 32.
            </Term>
            <Term label="People who open a shared link:">
              Only the standard technical data described below; we do not ask you for anything.
            </Term>
            <Term label="Collected automatically:">
              IP address, browser and device type, operating system, application version, pages
              visited within the Services, timestamps, and log data generated by our hosting and
              error-monitoring providers. We use privacy-friendly aggregate analytics on our web
              surfaces; we do not use advertising or cross-site tracking cookies.
            </Term>
            <Term label="Cookies and local storage:">
              We use only what the Services need to function: an authentication session, a random
              device identifier stored in your browser to distinguish your device, and local
              storage for interface preferences and offline behaviour. Training candidates also
              receive a signed cookie that keeps them signed in to the training page. Clearing
              site data removes them and signs you out.
            </Term>
          </Clause>

          <Clause n={21} title="Why We Use It, and Our Lawful Bases">
            <DataTable
              head={['Purpose', 'Lawful basis (UK/EU GDPR)']}
              rows={[
                [
                  'Providing and securing the Services; managing accounts and access',
                  'Performance of a contract; legitimate interests in securing our systems',
                ],
                [
                  'Time tracking, payroll and billing verification, and workplace monitoring (staff)',
                  'Performance of a contract; legitimate interests in verifying billable time and protecting company and creator data; legal obligation where records must be kept',
                ],
                [
                  'Coordinating content, requests and deadlines (creators)',
                  'Performance of a contract',
                ],
                [
                  'Operating creator platform accounts and handling fan communications',
                  'Performance of a contract with the creator; processed on the creator’s instructions',
                ],
                [
                  'Diagnostics, error monitoring and product improvement',
                  'Legitimate interests in keeping the Services working correctly',
                ],
                [
                  'Assessing applications and running the personal onboarding form',
                  'Steps taken at your request prior to entering a contract',
                ],
                [
                  'Information about your sexual orientation or sex life that you give on the application and onboarding forms',
                  'Your explicit consent, given by providing it and withdrawable at any time (clause 26); if you withdraw, we may be unable to continue with your application',
                ],
                [
                  'Answering enquiries sent to hello@bluurock.com, including automated replies',
                  'Legitimate interests in responding to prospective creators and keeping the inbox free of abuse; steps taken at your request prior to entering a contract',
                ],
                [
                  'Running trial tests and assessing candidates, including the compulsory screen recording',
                  'Steps taken at your request prior to entering a contract; legitimate interests in checking that a candidate completed their own test and in protecting confidential test materials',
                ],
                [
                  'Device notifications and screen capture permissions',
                  'Consent, given at the operating-system level and withdrawable in your device settings',
                ],
                [
                  'Responding to legal requests, investigating misuse, and establishing or defending legal claims',
                  'Legal obligation; legitimate interests',
                ],
              ]}
            />
            <Term label="Automated decisions:">
              We do not make decisions producing legal or similarly significant effects about you
              by automated means alone. Monitoring data may inform decisions about work, but a
              person always makes those decisions.
            </Term>
          </Clause>

          <Clause n={22} title="Who We Share It With">
            <P>
              <B>We do not sell your personal data</B>, and we do not share it for advertising or
              cross-context behavioural advertising. We share it only with:
            </P>
            <List>
              <Item>
                <B>Service providers who process data on our behalf</B> under contract, listed in
                clause 25.
              </Item>
              <Item>
                <B>Other users of the Services</B> to the extent your role requires — for example,
                your name and profile picture are visible to colleagues, and the team managing a
                creator&rsquo;s account can see that account&rsquo;s operational records.
              </Item>
              <Item>
                <B>Our team, for applicants and candidates.</B> Applications are reviewed by the
                team members who hold the relevant permission. A candidate&rsquo;s name, email,
                submitted work and screen recording are visible to the administrators who run
                training, and the work is copied to our company Google Drive, where members of our
                team with access to that drive can see it.
              </Item>
              <Item>
                <B>Authorities, regulators or advisers</B> where we are required to disclose by
                law, or where disclosure is necessary to establish, exercise or defend legal
                claims.
              </Item>
              <Item>
                <B>A successor</B> in connection with a merger, acquisition or sale of assets,
                subject to this policy.
              </Item>
            </List>
          </Clause>

          <Clause n={23} title="International Transfers">
            <P>
              Our providers operate in the United States and other countries outside the UK and
              EEA, so your personal data may be transferred there. Where it is, we rely on
              adequacy decisions where they exist, and otherwise on Standard Contractual Clauses
              or the UK International Data Transfer Addendum, together with the technical
              protections in clause 24.
            </P>
          </Clause>

          <Clause n={24} title="Security">
            <P>
              We protect personal data with encryption in transit (TLS) and at rest, role-based
              access controls and per-page permissions, per-device session records that can be
              revoked, administrator-only access to monitoring data, and least-privilege access
              for our team. No system is perfectly secure; if a breach affects your personal data
              and is likely to result in a risk to your rights, we will notify you and the
              relevant supervisory authority as the law requires.
            </P>
          </Clause>

          <Clause n={25} title="Our Service Providers">
            <DataTable
              head={['Provider', 'What they process for us']}
              rows={[
                [
                  'Google (Firebase, Cloud Storage, Authentication, Drive, OAuth)',
                  'Identity and sign-in, database, file and screenshot storage, content uploads',
                ],
                [
                  'Vercel',
                  'Application hosting, request logs, aggregate usage and performance analytics',
                ],
                ['Sentry', 'Error and crash reporting, including limited diagnostic context'],
                [
                  'Resend',
                  'Email delivery, and receipt of messages sent to hello@bluurock.com',
                ],
                [
                  'Telegram',
                  'Creator Portal sign-in, and bot messages to creators and to staff who choose to link their account',
                ],
                ['Apify', 'Collection of publicly available social-media follower statistics'],
                [
                  'OnlyFans API provider',
                  'Integration with managed creator accounts, including message data handled on the creator’s behalf',
                ],
                [
                  'BuddyX and OnlyMonster',
                  'Sales and analytics data for the creator accounts we manage (amounts, timestamps, and fan and team-member identifiers), received read-only',
                ],
                [
                  'GoLogin',
                  'Browser profiles our team uses to operate managed accounts',
                ],
              ]}
            />
            <P>
              Where a provider processes data on our behalf, it does so under a data processing
              agreement, on our instructions, and may not use the data for its own purposes.
              Telegram is the exception: it is an independent platform that you use under its own
              terms and privacy policy, and it receives what you send and do within it. We review
              this list as our stack changes; the version published here is current as of the
              effective date above.
            </P>
          </Clause>

          <Clause n={26} title="Your Rights">
            <P>
              Depending on where you live, you have some or all of the following rights over your
              personal data:
            </P>
            <List>
              <Item>
                <B>Access</B> — a copy of the personal data we hold about you, including
                monitoring data.
              </Item>
              <Item>
                <B>Rectification</B> — correction of inaccurate or incomplete data.
              </Item>
              <Item>
                <B>Erasure</B> — deletion where we no longer have a lawful reason to keep it. This
                includes deletion of a specific screenshot that captured something private.
              </Item>
              <Item>
                <B>Restriction and objection</B> — including the right to object to processing
                based on our legitimate interests, such as monitoring.
              </Item>
              <Item>
                <B>Portability</B> — a machine-readable copy of data you provided to us.
              </Item>
              <Item>
                <B>Withdraw consent</B> — where we rely on consent, at any time, without affecting
                processing already carried out.
              </Item>
              <Item>
                <B>Non-discrimination</B> — we will not treat you detrimentally for exercising any
                of these rights.
              </Item>
            </List>
            <Term label="How to exercise them:">
              Email{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-white underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>
              . We respond within one month, and will tell you if we need longer or need to verify
              your identity first.
            </Term>
            <Term label="Complaints:">
              If you are in the UK you may complain to the Information Commissioner&rsquo;s Office
              (
              <a
                href="https://ico.org.uk"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white underline underline-offset-2"
              >
                ico.org.uk
              </a>
              ); elsewhere in the EEA, to your local supervisory authority. We would appreciate
              the chance to resolve it with you first.
            </Term>
          </Clause>

          <Clause n={27} title="Children">
            <P>
              The Services are not intended for anyone under 18, we do not knowingly collect
              personal data from anyone under 18, and we will delete any such data as soon as we
              become aware of it.
            </P>
          </Clause>

          <Clause n={28} title="Changes to This Policy">
            <P>
              We update this policy as our systems change. The effective date and version at the
              top of this page always reflect the current version, and material changes are
              notified as described in clause 1.
            </P>
          </Clause>
        </Part>

        {/* ═══ PART E ═══════════════════════════════════════════════════ */}
        <Part
          id="part-e"
          letter="E"
          title="Applicants, Candidates and Other Visitors"
          audience="People who use a Bluu Rock page without an account — model applicants, people we have invited to onboard, training candidates, people who email hello@bluurock.com, and anyone who opens a link we share. Staff and creators are covered by Parts B and C."
        >
          <Clause n={29} title="Using a Public Page Without an Account">
            <Term label="What this part is for:">
              Some of our pages are open to people who have no Bluu Rock account. Using one does
              not make you an employee, contractor, creator or client, and does not create an
              account. Parts A and D apply to you in full; Parts B and C do not, unless you later
              become staff or a creator.
            </Term>
            <Term label="Age:">
              You must be at least <B>18 years old</B> to use any of these pages. By submitting a
              form or starting a test you confirm that you are.
            </Term>
            <Term label="Be accurate and be yourself:">
              Give true and complete information. Submit only photographs of yourself, and only
              ones taken when you were over 18. Do not use another person&rsquo;s name, email
              address, images or identity, and do not take a test for someone else or let anyone
              take yours.
            </Term>
            <Term label="Protection against abuse:">
              Public pages can be misused, so we apply technical limits to them — signed
              single-use sessions, rate limits tied to a one-way hashed form of your IP address,
              and checks on the files you send. We may refuse, remove or block any submission or
              person, without giving a reason, where we suspect misuse.
            </Term>
          </Clause>

          <Clause n={30} title="Applications and Onboarding">
            <Term label="The application form:">
              The model application form asks for your contact details, age, location, sexual
              orientation, social media pages and, if you have one, your OnlyFans trial link and
              earnings screenshots. It also asks for selfies and body photographs. Photographs are
              uploaded <B>as you choose them</B>, before you press Submit; one you remove from the
              form is deleted. By submitting you confirm that the photographs show you, that you
              were over 18 when they were taken, and that you agree to us viewing them to assess
              your application.
            </Term>
            <Term label="Review:">
              A member of our team reviews each application. We make no automated decision about
              you. Applying creates no right to be accepted and no contract. We may decline an
              application, or not reply, without giving a reason.
            </Term>
            <Term label="Contact:">
              We may contact you through the Telegram handle, WhatsApp number or email address you
              gave us.
            </Term>
            <Term label="Your personal onboarding link:">
              If we approve you, we may email you a personal link to a longer onboarding form. That
              link <B>is your credential</B>: it has no password, and anyone who holds it can see
              and change what is saved under it. Do not forward it, post it or share a screenshot
              of it. If it leaks, tell us and we will issue a new one.
            </Term>
            <Term label="Answers are saved as you type:">
              The onboarding form saves your answers as you go, before you press send, and fills in
              some of them from your application. Answers you have not sent stay on file until you
              complete the form or we remove them. You can change anything we have prefilled.
            </Term>
            <Term label="What the onboarding form asks:">
              Your date of birth, location, social pages, equipment and shooting locations,
              availability, earnings history and goals, the kinds of content you will and will not
              make, and details of the persona you would present. Some of these answers concern
              your sexual orientation or sex life, which the law treats as especially sensitive.
              You decide what to tell us; by giving it you give your explicit consent to our using
              it to assess and onboard you (clause 21), and you may withdraw that consent at any
              time (clause 26).
            </Term>
            <Term label="Not an agreement to work together:">
              Completing the onboarding form is not a management agreement. If you become a
              creator, Part C applies from then, and your signed management agreement prevails
              over this document as clause 1 describes.
            </Term>
          </Clause>

          <Clause n={31} title="Enquiries to hello@bluurock.com">
            <Term label="Automated triage:">
              Messages sent to hello@bluurock.com pass through automated triage that applies fixed
              rules. If a message looks like a genuine enquiry from a prospective creator, you may
              receive an automatic reply with a link to the application form. Other messages are
              held for a person to look at, or are logged and not answered. We do not promise a
              reply to every message.
            </Term>
            <Term label="What we keep:">
              We keep the sender, subject and an excerpt of each message, how it was classified,
              and what we did about it. Email is not a secure channel: send your application
              through the form, not by attaching photographs or personal documents to an email.
            </Term>
          </Clause>

          <Clause n={32} title="Training Candidates and Trial Tests">
            <Term label="How you get in:">
              An administrator adds your email address to a training module. You enter that
              address on the training page and we email you a six-digit code; entering it signs
              you in and sets a signed cookie that keeps you signed in on that browser for up to
              seven days. Do not share the code or use anyone else&rsquo;s.
            </Term>
            <Term label="How the tests work:">
              Each test is a timed assessment on a computer, and you sit it once. Your own clock
              starts when you press Start. The team may end an attempt, or switch a module off, at
              any time; anything you have already uploaded is kept.
            </Term>
            <Term label="Screen recording is compulsory:">
              Every attempt is screen-recorded, and you cannot start one without it. You will be
              asked to share your <B>whole screen</B>, and a still image is taken to check that you
              have. While the attempt runs we record <B>everything visible on the screen you
              share</B> — including other applications&rsquo; windows, notifications and private
              messages — together with the name and email shown at the top of the training page.
              The recording is sent to our storage in short segments as you work, and our
              administrators can watch it live and replay it afterwards.
            </Term>
            <Term label="What is not recorded:">
              The recording is video only. We do not record sound, we do not use your camera, and
              we do not read your files or log what you type, other than what appears on the
              screen you share.
            </Term>
            <Term label="Protect your own privacy:">
              Before you start, close personal windows, applications and messages, and turn off
              notifications. If a recording captures something private, email{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-white underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              and we will delete the recording of that attempt.
            </Term>
            <Term label="Test materials:">
              The images and datasets you are given are confidential and are for use in the test
              only. Do not download, copy, share, post or keep them (clause 4). Some contain
              images of real people, and some tests include adult and explicit material; if you
              are not comfortable with that, do not start a test.
            </Term>
            <Term label="Your work:">
              The files, final images and written answers you submit are stored with your
              recording, copied to our company Google Drive under your name, and reviewed by our
              team to assess you. Submit only work you made yourself during the test, and only
              what you have the right to submit.
            </Term>
            <Term label="A test is not a job:">
              Sitting a test is an assessment. It does not by itself make you an employee,
              contractor, creator or client of Bluu Rock, and it is no promise of an offer. Any
              engagement is agreed separately in writing.
            </Term>
          </Clause>

          <Clause n={33} title="Links We Share With You">
            <Term label="No account needed:">
              Our team may send you a link to a read-only page or a screenshot or screen recording.
              Opening it needs no account: the link itself is the access, so anyone who holds it
              can open it. Do not forward or post it unless the sender meant you to. A screen
              recording may include sound chosen by the person who made it.
            </Term>
            <Term label="It can disappear:">
              We may revoke a link, or the content behind it may expire or be removed, at any time
              without notice, after which the link stops working.
            </Term>
            <Term label="What applies to you:">
              What you see through a link is confidential to Bluu Rock (clause 4). Opening one
              involves only the standard technical data described in clause 20; we ask you for
              nothing.
            </Term>
          </Clause>
        </Part>

        {/* ── Acknowledgement ──────────────────────────────────────────── */}
        <section className="mt-16 border-t pt-8" style={{ borderColor: HAIRLINE }}>
          <h2 className="text-lg font-semibold text-white">Acknowledgement</h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            By signing in to <B>Bluu Backend</B> or the <B>Creator Portal</B>, by submitting a
            form, opening a personal onboarding link or signing in to a training page, or by
            taking a test or otherwise using a Bluu Rock page or link, you acknowledge that you
            have read, understood and agreed to this document, including the monitoring described
            in Part B and the recording described in Part E where they apply to you, and the
            privacy practices described in Part D.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Questions about anything on this page go to{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-white underline underline-offset-2 transition-colors hover:text-zinc-300"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <p className="mt-6 text-xs text-zinc-500">
            Version {VERSION} · Effective {EFFECTIVE_DATE} · Bluu Rock MGMT
          </p>
        </section>
      </article>
    </main>
  );
}
