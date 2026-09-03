import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use & Privacy Policy · Bluu Rock MGMT',
  description:
    'Terms of use and privacy policy for Bluu Backend and the Bluu Rock Creator Portal.',
};

/**
 * The published legal document for every Bluu Rock surface.
 *
 * This page is the SINGLE SOURCE OF RECORD. It is deliberately one document
 * covering three audiences (staff, creators, applicants) rather than several,
 * because separate documents drift apart and a user cannot tell which one binds
 * them. Part A binds everyone; Part B adds the staff-only monitoring terms;
 * Part C adds the creator terms; Part D is the privacy policy and applies to
 * everyone.
 *
 * It is reachable from: the internal Login screen, onboarding step 1
 * (`/onboarding/welcome`, where acceptance is recorded as `hasAcceptedTerms`),
 * the creator login screen, and the creator welcome page. `/terms` is
 * allowlisted in `src/middleware.ts` so it resolves outside Electron.
 *
 * RULE — bump `VERSION` and `EFFECTIVE_DATE` together on any substantive edit.
 * `hasAcceptedTerms` is only a boolean, so the version printed here is currently
 * the only record of what a user agreed to.
 */

const EFFECTIVE_DATE = 'September 2, 2026';
const VERSION = '2.0';
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
          governs three separate surfaces:
        </p>
        <List>
          <Item>
            <B>Bluu Backend</B> — the internal desktop application used by Bluu Rock employees
            and contractors.
          </Item>
          <Item>
            <B>The Creator Portal</B> — the browser application at{' '}
            <span className="text-zinc-300">app.bluurock.com/creator</span>, used by the creators
            and clients whose accounts we manage.
          </Item>
          <Item>
            <B>Our public forms</B> — the model application form and any other publicly reachable
            page we publish.
          </Item>
        </List>
        <p className="mt-3 text-sm leading-relaxed text-pretty text-zinc-400">
          Together these are the <B>&ldquo;Services&rdquo;</B>. Read the part that applies to you
          alongside <B>Part A</B> and <B>Part D</B>, which apply to everyone. By creating an
          account, signing in, or using any of the Services, you agree to this document. If you do
          not agree, do not use the Services.
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
          audience="Every user of every Bluu Rock service — staff, creators, clients and applicants."
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
              contractors, creators, clients and other persons expressly authorised by Bluu Rock.
            </Term>
            <Term label="No self-registration:">
              Accounts are created by an administrator. Until an administrator has registered your
              address, sign-in is refused. If your sign-in is blocked, contact your team leader or
              account manager.
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
              described in clause 17 (creators) or, for staff, the rights already granted under
              your employment or contractor agreement.
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
          audience="Bluu Rock employees and contractors using the Bluu Backend desktop application. Creators and clients can skip to Part C."
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
              operating system and crash reports.
            </Term>
            <Term label="What we do NOT do:">
              We do not log keystrokes or capture what you type. We do not access your camera or
              microphone. We do not read your files, your browsing history, your email, or any
              other application&rsquo;s data. We do not track your physical location. We do not
              monitor you outside a Clocked In session.
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
          audience="Creators and clients whose accounts Bluu Rock manages, using the Creator Portal."
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
              Your Portal account is created for you by a Bluu Rock administrator using your email
              address, and you sign in with an email address and password. Change the password we
              issue you at the first opportunity, keep it confidential, and never share the
              account with anyone — including an assistant, partner or agency — without our
              written agreement.
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
              The Portal can be installed to your phone&rsquo;s home screen. If you enable device
              notifications, we may use them to alert you to new or overdue items. You can turn
              them off in your device settings at any time.
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
          audience="Everyone whose personal data Bluu Rock handles through the Services — staff, creators, clients and applicants."
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
              detected timezone, your upload link, and the operational records associated with
              your account — custom requests and campaigns, content plan items, due dates,
              statuses and completion timestamps, tracking amounts, and comments entered by you or
              by our team.
            </Term>
            <Term label="Fan-related information:">
              In the course of managing creator accounts we handle information about fans —
              display names, profile links, message content, purchase and request details. This is
              handled on the creator&rsquo;s behalf and is treated as confidential.
            </Term>
            <Term label="Applicants (public forms):">
              The information you submit on the model application form, including the images you
              upload, and limited technical data collected to prevent abuse.
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
              storage for interface preferences and offline behaviour. Clearing site data removes
              them and signs you out.
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
                  'Assessing applications submitted through public forms',
                  'Steps taken at your request prior to entering a contract',
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
                ['Resend', 'Transactional email delivery'],
                ['Apify', 'Collection of publicly available social-media follower statistics'],
                [
                  'OnlyFans API provider',
                  'Integration with managed creator accounts, including message data handled on the creator’s behalf',
                ],
              ]}
            />
            <P>
              Each acts under a data processing agreement, may only process data on our
              instructions, and may not use it for their own purposes. We review this list as our
              stack changes; the version published here is current as of the effective date above.
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

        {/* ── Acknowledgement ──────────────────────────────────────────── */}
        <section className="mt-16 border-t pt-8" style={{ borderColor: HAIRLINE }}>
          <h2 className="text-lg font-semibold text-white">Acknowledgement</h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            By signing in to <B>Bluu Backend</B> or the <B>Creator Portal</B>, you acknowledge
            that you have read, understood and agreed to this document, including the monitoring
            described in Part B where it applies to you and the privacy practices described in
            Part D.
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
