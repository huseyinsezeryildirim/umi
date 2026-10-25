import type { Metadata } from "next";
import { LegalPage } from "@/components/Legal";

export const metadata: Metadata = { title: "Copyright Policy · Umi", description: "How to report copyright infringement on Umi, and how to respond to a report." };

// Draft for legal review. Bracketed items ([…]) are to be filled in before publishing.
const AGENT = "hi@ux.center";

export default function Page() {
  return (
    <LegalPage
      title="Copyright Policy"
      updated="October 25, 2026"
      intro={
        <p>
          We respect the rights of creators and expect people who use Umi to do the same. This policy explains how to tell us about videos on Umi Cloud
          that you believe infringe your copyright, and what happens next. It follows the notice-and-takedown procedure of the U.S. Digital Millennium
          Copyright Act (17 U.S.C. § 512), the EU Digital Services Act, and Turkish Law No. 5651 and Law No. 5846 on Intellectual and Artistic Works, as
          applicable.
        </p>
      }
      sections={[
        [
          "Before you send a notice",
          <p>
            Only the copyright owner, or someone authorized to act for them, may submit a notice. Consider whether the use may be permitted, for example as
            fair use, quotation, criticism, commentary or parody. Knowingly submitting a false notice may make you liable for damages (17 U.S.C. § 512(f)).
            For a quick report you can also use “Report this video” on the video’s page; a formal notice by email is needed for the steps below.
          </p>,
        ],
        [
          "How to send a notice",
          <>
            <p>
              Email our designated copyright agent at <a className="underline" href={`mailto:${AGENT}`}>{AGENT}</a> with the subject “Copyright notice”,
              including:
            </p>
            <ol className="list-decimal space-y-1 pl-6">
              <li>your physical or electronic signature;</li>
              <li>identification of the copyrighted work you claim is infringed;</li>
              <li>the Umi link(s) to the material you claim is infringing (for example, umi.cam/v/…), and, where useful, the time in the video;</li>
              <li>your name, postal address, telephone number and email address;</li>
              <li>a statement that you have a good-faith belief that the use is not authorized by the copyright owner, its agent or the law;</li>
              <li>
                a statement that the information in the notice is accurate and, under penalty of perjury, that you are the owner or authorized to act on the
                owner’s behalf.
              </li>
            </ol>
            <p>Designated agent: [Legal entity name], Attn: Copyright Agent, [registered address], {AGENT}.</p>
          </>,
        ],
        [
          "What we do",
          <p>
            When we receive a complete notice we act expeditiously to remove or disable access to the material, notify the person who uploaded it, and send
            them a copy of the notice (your contact details may be included so they can resolve it with you directly). Incomplete notices may not be acted
            on; we will tell you what is missing.
          </p>,
        ],
        [
          "Counter-notice",
          <>
            <p>If you believe material you uploaded was removed by mistake or misidentification, you may send a counter-notice to {AGENT} including:</p>
            <ol className="list-decimal space-y-1 pl-6">
              <li>your physical or electronic signature;</li>
              <li>identification of the material removed and the link where it appeared;</li>
              <li>a statement under penalty of perjury that you have a good-faith belief it was removed as a result of mistake or misidentification;</li>
              <li>
                your name, address and telephone number, and a statement that you consent to the jurisdiction of the courts of your address (or, if outside
                the United States, any judicial district in which we may be found) and will accept service of process from the person who sent the notice.
              </li>
            </ol>
            <p>
              We will forward the counter-notice to the complainant. Unless they tell us within 10 business days that they have filed a court action to
              restrain the alleged infringement, we may restore the material within 10–14 business days after receiving the counter-notice.
            </p>
          </>,
        ],
        [
          "Repeat infringers",
          <p>
            We close the accounts of users who are repeatedly the subject of valid notices, in appropriate circumstances and at our discretion.
          </p>,
        ],
        [
          "Other complaints",
          <p>
            For trademark, privacy or other legal complaints, or reports of illegal content, use “Report this video” on the page or email {AGENT}. Reports
            of child sexual abuse material are also referred to the competent authorities.
          </p>,
        ],
      ]}
    />
  );
}
