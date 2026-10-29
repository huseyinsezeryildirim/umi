import type { Metadata } from "next";
import { LegalPage } from "@/components/Legal";

export const metadata: Metadata = { title: "Privacy Policy · Umi", description: "What personal data Umi processes, why, and your rights under KVKK and GDPR." };

// Draft for legal review.
const CONTACT = "hi@ux.center";

const Table = (props: { rows: [string, string, string][] }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[560px] border-collapse text-left text-[14.5px]">
      <thead>
        <tr className="border-b border-line">
          <th className="py-2 pr-4 font-semibold">Data</th>
          <th className="py-2 pr-4 font-semibold">Why</th>
          <th className="py-2 font-semibold">Legal basis</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map(([a, b, c]) => (
          <tr key={a} className="border-b border-line align-top">
            <td className="py-2 pr-4">{a}</td>
            <td className="py-2 pr-4">{b}</td>
            <td className="py-2">{c}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default function Page() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="October 29, 2026"
      intro={
        <>
          <p>
            Umi is built so that your recordings stay on your computer. Recording, editing, exporting and the AI features (captions, voiceover, noise and
            background removal, titles) run on your device; nothing is sent to us unless you create a share link or otherwise choose to upload. There are
            no ads, no advertising trackers and no analytics scripts on our website or in our apps.
          </p>
          <p className="mt-4">
            This policy explains what personal data we do process when you use the Umi apps, the website at umi.cam and Umi Cloud (the “Service”), and the
            rights you have under the Turkish Personal Data Protection Law No. 6698 (“KVKK”), the EU and UK General Data Protection Regulation (“GDPR”) and
            other applicable laws. It also serves as our information notice (aydınlatma metni) under Article 10 of KVKK.
          </p>
        </>
      }
      sections={[
        [
          "Who is responsible",
          <p>
            The data controller (veri sorumlusu) is Hüseyin Sezer Yıldırım (sole proprietorship), Akfırat Mah. 43. Sk., 34959 Tuzla, İstanbul, Türkiye. Contact us about privacy at{" "}
            <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>,
        ],
        [
          "What stays on your device",
          <p>
            Recordings, projects, edits, transcripts, presets and settings made in the desktop apps are stored in folders on your computer. In the web app
            they are stored in your browser (IndexedDB) and never uploaded unless you share them. AI models are downloaded once and run locally. We cannot
            see this data.
          </p>,
        ],
        [
          "What we process, why, and on what basis",
          <>
            <Table
              rows={[
                ["Account: email address, password (stored only as a salted hash), email-verification state, plan", "To create and secure your account, sign you in and provide your plan", "Performance of a contract (KVKK Art. 5(2)(c); GDPR Art. 6(1)(b))"],
                ["Session tokens (stored only as hashes)", "To keep you signed in on your devices", "Contract"],
                ["Videos you share, with their title, poster image, preview GIF, length, size and link settings", "To host the video and show it to the people you share the link with", "Contract"],
                ["Comments and reactions viewers leave: the name they type, the text, the time in the video, and a keyed hash of their IP address (for spam limits)", "To show them on the video page", "Contract with the viewer; our legitimate interest in providing the feature"],
                ["Viewing statistics: a random session id, which parts were watched, watch time, country (derived from the IP address by our host; the IP address itself is not stored), whether it was embedded", "To show owners how their video was watched (on plans that include insights)", "Legitimate interest (KVKK Art. 5(2)(f); GDPR Art. 6(1)(f))"],
                ["Reports about a video: the reason, the details the reporter writes, and a keyed hash of their IP address (one report per person)", "To review abuse and legal complaints", "Legal obligation (Law No. 5651) and legitimate interest"],
                ["Keyed hashes of IP addresses and account ids, kept for at most 2 days", "Rate limits against spam, password guessing and abuse", "Legitimate interest in keeping the Service secure"],
                ["Billing details (handled by our payment provider; we receive your plan, country and a customer reference, never card numbers)", "To sell and renew subscriptions, issue invoices and meet tax obligations", "Contract; legal obligation (Tax Procedure Law No. 213)"],
                ["Emails we send you (verification, password reset, important notices) and your messages to us", "To run your account and answer you", "Contract; legitimate interest"],
                ["Technical request logs at our hosting provider (IP address, time, URL, user agent)", "Security and troubleshooting", "Legitimate interest"],
              ]}
            />
            <p>We do not sell personal data, use it for advertising, or use your videos to train AI models.</p>
          </>,
        ],
        [
          "Cookies and local storage",
          <p>
            We use no advertising or analytics cookies. We use strictly necessary storage only: a cookie that remembers that you entered a video’s password
            (24 hours), the sign-in token of the website and web app in your browser’s local storage, and your preferences (such as playback speed). Because
            these are necessary to provide what you ask for, no consent banner is required.
          </p>,
        ],
        [
          "Who we share data with",
          <>
            <p>We use these service providers (processors), bound by contracts to process data only on our instructions:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Cloudflare, Inc. (USA) — hosting, storage of shared videos and our database, network security;</li>
              <li>Cloudflare, Inc. (USA) also sends our account emails; Resend, Inc. (USA) sends them when Cloudflare can’t;</li>
              <li>Paddle.com Market Ltd (United Kingdom) and its affiliates — payments, as our reseller and merchant of record. Paddle collects your name,
                email, country, payment details and IP address at checkout under its own privacy policy, as an independent controller for the purchase;</li>
              <li>GitHub, Inc. (USA) — distributing app downloads and updates (your app requests update information from GitHub).</li>
            </ul>
            <p>
              Some features download files from other services the first time you use them, which then see your IP address like any website you visit:
              on-device AI models (captions, voice, camera effects in the desktop apps, and captions and voice in the web app) come from Hugging Face, Inc.
              (USA) and GitHub, Inc. (USA), the web app’s AI runtime from jsDelivr (a public CDN), and tracks from the music library come from the Internet Archive (USA). Nothing about you or your recordings is
              sent with these downloads. Everything else, including fonts and the camera effects in the web app and the video player, is served by Umi.
            </p>
            <p>
              Anyone with a share link can see the video, its title, comments and reactions, unless you protect it with a password or delete it. We disclose
              data to authorities only when required by law.
            </p>
          </>,
        ],
        [
          "International transfers",
          <p>
            Our providers process data outside Türkiye and the EU/EEA, including in the United States. We transfer data on the basis of standard contractual
            clauses as provided in Article 9 of KVKK (and notified to the Personal Data Protection Authority where required) and the European Commission’s
            standard contractual clauses or adequacy decisions under GDPR.
          </p>,
        ],
        [
          "How long we keep data",
          <ul className="list-disc space-y-1 pl-6">
            <li>Free share links: 7 days, plus up to 7 days in which you can restore them by upgrading; then the files are deleted.</li>
            <li>Paid share links: until you delete them, or 30 days after your paid plan ends.</li>
            <li>When you delete a video or your account, the files are deleted at once and the remaining records within 30 days (backups roll over within 30 days).</li>
            <li>Rate-limit counters: up to 2 days. Reports: as long as needed to handle them and for up to 2 years afterwards, to deal with repeat abuse and legal claims, unless the video’s owner deletes their account first.</li>
            <li>Invoices and billing records: 10 years, as required by Turkish commercial and tax law.</li>
          </ul>,
        ],
        [
          "Your rights",
          <>
            <p>
              Under Article 11 of KVKK you may ask whether we process your data; for information about it; for its purpose and whether it is used
              accordingly; who it is transferred to, in Türkiye or abroad; for correction of incomplete or inaccurate data; for its erasure or destruction;
              for third parties to be notified of corrections or erasure; to object to a result against you arising solely from automated analysis; and for
              compensation if you suffer damage from unlawful processing.
            </p>
            <p>
              Under GDPR you also have the rights of access, rectification, erasure, restriction, data portability, and to object to processing based on
              legitimate interests, and to withdraw consent at any time where we rely on it.
            </p>
            <p>
              You can delete videos and your whole account yourself in the app. For any other request, write to {CONTACT} from your account’s email address.
              We answer within 30 days, free of charge. You may also complain to the Personal Data Protection Authority (KVKK Kurumu, kvkk.gov.tr) or to the
              data protection authority where you live in the EU/UK.
            </p>
          </>,
        ],
        [
          "Security",
          <p>
            Data is encrypted in transit (HTTPS) and at rest at our providers. Passwords and tokens are stored only as salted hashes. Access to the moderation
            and administration tools is restricted and logged. No method is perfectly secure; if a breach affects your data we will notify you and the
            authorities as the law requires.
          </p>,
        ],
        [
          "Children",
          <p>The Service is not directed at children under 16, and we do not knowingly collect their data. If you believe a child has given us data, contact us and we will delete it.</p>,
        ],
        [
          "Changes",
          <p>We will post changes here and update the date above. For material changes we will notify account holders by email before they take effect.</p>,
        ],
      ]}
    />
  );
}
