import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use · Bluu Backend',
  description: 'Terms of use for Bluu Backend, the internal platform of Bluu Rock MGMT.',
};

const EFFECTIVE_DATE = 'March 8, 2026';

const HAIRLINE = 'rgba(255,255,255,0.07)';

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
      <h2 className="text-lg font-semibold text-white">
        <span className="mr-2 tabular-nums text-zinc-500">{n}.</span>
        {title}
      </h2>
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

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <article className="mx-auto w-full max-w-[68ch]">
        <header className="border-b pb-8" style={{ borderColor: HAIRLINE }}>
          <h1 className="text-2xl font-semibold text-balance text-white">
            Bluu Backend Terms of Use
          </h1>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1.5 text-xs text-zinc-400">
            <div className="flex gap-2">
              <dt className="text-zinc-500">Effective date</dt>
              <dd className="tabular-nums">{EFFECTIVE_DATE}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Owner</dt>
              <dd>Bluu Rock MGMT</dd>
            </div>
          </dl>
        </header>

        <p className="mt-8 text-sm leading-relaxed text-pretty text-zinc-400">
          Welcome to <strong className="font-semibold text-white">Bluu Backend</strong>. By
          accessing or using this internal SaaS application, you (the &ldquo;User&rdquo;) agree
          to comply with and be bound by the following terms and conditions. This application is
          for the exclusive use of <strong className="font-semibold text-white">Bluu Rock MGMT</strong>{' '}
          employees and authorized personnel.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-pretty text-zinc-400">
          Within the Bluu Backend ecosystem,{' '}
          <strong className="font-semibold text-white">&lsquo;Clocked In&rsquo;</strong> denotes
          any period where a User has explicitly activated the time-tracking feature. All time
          recorded in this state is classified as company time and is eligible for billing.
          Please be advised that by clocking in, Users acknowledge and authorize the collection
          of relevant analytical User data as part of our standard quality assurance and
          productivity verification protocols.
        </p>

        <Clause n={1} title="Authorized Access">
          <Term label="Internal Use Only:">
            Bluu Backend is a proprietary tool. Access is strictly limited to active employees,
            contractors, clients, and any persons authorized by Bluu Rock MGMT.
          </Term>
          <Term label="Credential Security:">
            Users are responsible for maintaining the confidentiality of their login credentials.
            Any unauthorized access resulting from shared passwords may lead to disciplinary
            action.
          </Term>
          <Term label="Termination of Access:">
            Upon termination of employment or contract, access to Bluu Backend will be revoked
            immediately.
          </Term>
        </Clause>

        <Clause n={2} title="Activity Monitoring & Screenshots">
          <p className="text-sm leading-relaxed text-zinc-400">
            To ensure productivity, project accuracy, and security, Bluu Backend includes
            automated monitoring features.
          </p>
          <Term label="Screenshot Capture:">
            The application may capture periodic screenshots at random intervals every 15 minutes
            of the User&rsquo;s screen(s) specifically while the User is{' '}
            <strong className="font-semibold text-white">&ldquo;Clocked In&rdquo;</strong> or
            actively recording time for a project. Users with system-level notifications enabled
            will receive automated alerts upon the successful capture of a screenshot.
          </Term>
          <Term label="Storage & Security:">
            All captured screenshots are encrypted and stored securely within our private
            database. They are treated as confidential company data.
          </Term>
          <Term label="No External Sharing:">
            Screenshots are used solely for internal management, auditing, and quality assurance.
            Bluu Rock MGMT will not share these images with third parties unless required by law.
          </Term>
          <Term label="Deletion Requests:">
            We respect employee privacy. If a screenshot inadvertently captures sensitive personal
            information (e.g., a banking window or private message), the User may request the
            deletion of specific screenshots by contacting the System Administrator.
          </Term>
        </Clause>

        <Clause n={3} title="Acceptable Use">
          <p className="text-sm leading-relaxed text-zinc-400">
            Users agree <strong className="font-semibold text-white">not</strong> to:
          </p>
          <ul className="space-y-2 pl-5 text-sm leading-relaxed text-zinc-400">
            <li className="list-disc marker:text-zinc-600">
              Use Bluu Backend for any personal, illegal, or unauthorized purposes.
            </li>
            <li className="list-disc marker:text-zinc-600">
              Attempt to reverse-engineer, decompile, or bypass the security protocols of the
              application.
            </li>
            <li className="list-disc marker:text-zinc-600">
              Upload malicious software or code to the backend environment.
            </li>
          </ul>
        </Clause>

        <Clause n={4} title="Proprietary Rights">
          <p className="text-sm leading-relaxed text-zinc-400">
            All content, code, architecture, and data within Bluu Backend are the sole property of{' '}
            <strong className="font-semibold text-white">Bluu Rock MGMT</strong>. Unauthorized
            distribution of internal data or software trade secrets is strictly prohibited and may
            result in legal action.
          </p>
        </Clause>

        <section className="mt-12 border-t pt-8" style={{ borderColor: HAIRLINE }}>
          <h2 className="text-lg font-semibold text-white">
            Disclaimers &amp; Limitation of Liability
          </h2>
          <div
            className="mt-4 space-y-4 rounded-xl border p-5"
            style={{ background: 'rgba(255,255,255,0.025)', borderColor: HAIRLINE }}
          >
            <Term label="&ldquo;As-Is&rdquo; Basis:">
              Bluu Backend is provided on an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo;
              basis. Bluu Rock MGMT makes no warranties, expressed or implied, regarding the
              continuous availability or error-free operation of the application.
            </Term>
            <Term label="Data Loss:">
              While we utilize secure database backups, Bluu Rock MGMT is not liable for the loss
              of any data or progress due to system timeouts, hardware failure, or connectivity
              issues.
            </Term>
            <Term label="Privacy Expectation:">
              While &ldquo;Clocked In&rdquo; on a company-mandated tool, Users should have a
              limited expectation of privacy regarding on-screen activities. Users are encouraged
              to close personal windows and applications before beginning their shift.
            </Term>
          </div>
        </section>

        <section className="mt-12 border-t pt-8" style={{ borderColor: HAIRLINE }}>
          <h2 className="text-lg font-semibold text-white">Acknowledgement</h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            By logging into <strong className="font-semibold text-white">Bluu Backend</strong>,
            you acknowledge that you have read, understood, and agreed to these Terms of Use and
            the monitoring policies described herein.
          </p>
        </section>
      </article>
    </main>
  );
}
