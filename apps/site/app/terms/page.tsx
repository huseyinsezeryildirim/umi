import type { Metadata } from "next";
import { LegalPage } from "@/components/Legal";

export const metadata: Metadata = { title: "Terms of Service · Umi", description: "The terms for using Umi, the Umi apps and Umi Cloud." };

// Draft for legal review. Bracketed items ([…]) are to be filled in before publishing.
const CONTACT = "hi@ux.center";

export default function Page() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="October 25, 2026"
      intro={
        <>
          <p>
            These Terms of Service (the “Terms”) are a binding agreement between you and [Legal entity name], [registered address] (“Umi”, “we”, “us”), and
            govern your use of the Umi desktop apps, the Umi web app and browser extension, the website at umi.cam, and Umi Cloud, our hosted service for
            share links (together, the “Service”).
          </p>
          <p className="mt-4">
            By downloading the apps, creating an account or using the Service you accept these Terms. If you use the Service for an organization, you
            confirm you may bind it, and “you” includes that organization. If you don’t agree, don’t use the Service.
          </p>
        </>
      }
      sections={[
        [
          "The Service",
          <>
            <p>
              Umi lets you record, edit and export videos. Everything that runs on your own device — recording, editing, exporting, on-device AI features —
              is free. Umi Cloud stores videos you choose to share and serves them through links, under the plan you are on (Free or a paid plan).
            </p>
            <p>
              We may change, add or remove features. If we remove a paid feature you rely on, you may cancel and receive a pro-rated refund of the unused
              part of a prepaid period.
            </p>
          </>,
        ],
        [
          "Open-source software",
          <p>
            The Umi apps are open source. Your use of the source code is governed by its license (GNU Affero General Public License v3.0), which prevails over
            these Terms for the code itself. These Terms govern the hosted Service, our website and our brand. The Umi name and logo are our trademarks and
            are not licensed by the open-source license.
          </p>,
        ],
        [
          "Accounts",
          <>
            <p>
              You must be at least 16 years old (or the age of digital consent where you live, if higher) to create an account. Give accurate information,
              keep your password secure and tell us at {CONTACT} if you suspect unauthorized use. You are responsible for activity under your account.
            </p>
            <p>One person may create one free account. Accounts created to get around plan limits may be closed.</p>
          </>,
        ],
        [
          "Your content",
          <>
            <p>
              You keep all rights in the videos, audio, images, text and other material you record, upload or share (“Your Content”). We claim no
              ownership.
            </p>
            <p>
              You grant us a worldwide, non-exclusive, royalty-free license to host, store, copy, transcode, display and transmit Your Content only as
              needed to operate and provide the Service to you and to the people you share it with, including generating thumbnails and previews. This
              license ends when you delete Your Content, except for copies in backups that are deleted in the normal course (within 30 days) and where we
              must keep it by law.
            </p>
            <p>
              You confirm that you have all rights and consents needed for Your Content, including consent from people who appear or are heard in your
              recordings where the law requires it, and that your use of the Service does not infringe anyone’s rights.
            </p>
          </>,
        ],
        [
          "Acceptable use",
          <>
            <p>You must not use the Service to upload, share or link to content, or to engage in conduct, that:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>is illegal, or promotes or facilitates illegal activity;</li>
              <li>sexually exploits or endangers minors in any way;</li>
              <li>is sexually explicit, or contains non-consensual intimate imagery;</li>
              <li>harasses, threatens, defames or incites violence or hatred against any person or group;</li>
              <li>infringes copyright, trademark, privacy, publicity or other rights;</li>
              <li>contains malware, phishing or other deceptive or harmful material, or is spam;</li>
              <li>exposes other people’s personal data, credentials or confidential information without authorization;</li>
              <li>
                uses share links as general file hosting or a content delivery network, or otherwise loads the Service in a way that is not normal use of
                video sharing;
              </li>
              <li>probes, scans or tests the Service’s security, bypasses its limits, or interferes with its operation.</li>
            </ul>
            <p>
              Anyone can report a video from its page. We review reports and may hide or remove content, and suspend or close accounts, that we believe in
              good faith violate these Terms or the law. Where appropriate and lawful we will tell you what we did and why, and you may contact us to
              contest the decision.
            </p>
          </>,
        ],
        [
          "Plans, limits and fair use",
          <>
            <p>
              Free share links are limited in number, length and how long they stay available, as described on our pricing page. Paid plans include the
              storage and limits stated there. To keep the Service sustainable, we apply rate limits and may slow or stop activity that places an
              unreasonable load on it; we will contact you first where we reasonably can.
            </p>
            <p>
              When a paid plan ends or is downgraded to Free, share links that exceed the Free plan remain available for 30 days and are then deleted,
              unless you renew. Export anything you want to keep.
            </p>
          </>,
        ],
        [
          "Payment, renewal and cancellation",
          <>
            <p>
              Paid plans are billed in advance, monthly or yearly, and renew automatically until cancelled. Payments are processed by our reseller and
              merchant of record, [Payment provider], whose terms also apply to your purchase; prices may include or add applicable taxes.
            </p>
            <p>
              You can cancel at any time; your plan stays active until the end of the current period. Except where the law gives you a right of withdrawal
              or a refund, fees already paid are not refundable. We will give at least 30 days’ notice of price changes, which apply from your next renewal.
            </p>
          </>,
        ],
        [
          "Copyright complaints",
          <p>
            We respond to notices of alleged copyright infringement as described in our <a className="underline" href="/copyright">Copyright Policy</a>, and
            we close the accounts of repeat infringers in appropriate circumstances.
          </p>,
        ],
        [
          "Privacy",
          <p>
            Our [Privacy Policy] explains what personal data we process and why. Recording, editing and on-device AI features work locally; your recordings
            reach our servers only when you create a share link or otherwise choose to upload them.
          </p>,
        ],
        [
          "Third-party services",
          <p>
            The Service may let you import from or connect to third-party services (for example, importing videos from Loom). Those services are governed
            by their own terms; you are responsible for having the right to import such content.
          </p>,
        ],
        [
          "Suspension and termination",
          <p>
            You may stop using the Service and delete your account at any time. We may suspend or terminate your access if you materially breach these
            Terms, if required by law, or to protect the Service or others. Sections that by their nature should survive termination (including Your
            Content, disclaimers, limitation of liability and governing law) survive.
          </p>,
        ],
        [
          "Disclaimers",
          <p>
            The Service is provided “as is” and “as available”. To the extent permitted by law, we disclaim all warranties, express or implied, including
            merchantability, fitness for a particular purpose and non-infringement. We do not guarantee that the Service will be uninterrupted or error
            free, or that content will never be lost — keep your own copies of anything important.
          </p>,
        ],
        [
          "Limitation of liability",
          <>
            <p>
              To the extent permitted by law, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits,
              revenue, data or goodwill. Our total liability for all claims relating to the Service is limited to the greater of the amounts you paid us in
              the 12 months before the claim and USD 100.
            </p>
            <p>
              Nothing in these Terms limits liability that cannot be limited by law, including for gross negligence, willful misconduct, or death or
              personal injury, or your rights as a consumer under mandatory law.
            </p>
          </>,
        ],
        [
          "Indemnity",
          <p>
            If you use the Service for business purposes, you will defend and indemnify us against third-party claims arising from Your Content or your
            breach of these Terms, and pay resulting damages and reasonable costs, provided we notify you promptly and let you control the defense.
          </p>,
        ],
        [
          "Changes to these Terms",
          <p>
            We may update these Terms. For material changes we will give at least 30 days’ notice by email or in the Service before they take effect. If
            you continue to use the Service after that, the new Terms apply; if you don’t agree, you may cancel and stop using the Service.
          </p>,
        ],
        [
          "Governing law and disputes",
          <p>
            These Terms are governed by the laws of [Republic of Türkiye], without regard to conflict-of-law rules, and the courts of [Istanbul (Çağlayan)]
            have exclusive jurisdiction, except that consumers keep the protection of the mandatory laws and courts of the country where they live.
          </p>,
        ],
        [
          "Contact",
          <p>
            [Legal entity name], [registered address]. Email: <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>,
        ],
      ]}
    />
  );
}
