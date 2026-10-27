import type { Metadata } from "next";
import { LegalPage } from "@/components/Legal";

export const metadata: Metadata = { title: "Code Signing Policy · Umi", description: "How Umi's apps are built and signed." };

const REPO = "https://github.com/huseyinsezeryildirim/umi";
const PERSON = "https://github.com/huseyinsezeryildirim";

export default function Page() {
  return (
    <LegalPage
      title="Code Signing Policy"
      updated="October 26, 2026"
      intro={
        <p>
          Every Umi app you download is built from the public source code in <a className="underline" href={REPO}>{REPO.replace("https://", "")}</a>{" "}
          by GitHub Actions, then signed, so your computer can tell it really comes from us and wasn’t changed on the way.
        </p>
      }
      sections={[
        [
          "Windows",
          <p>
            The Windows installer isn’t code signed yet, so Windows may say it “protected your PC” the first time you open it: click More info,
            then Run anyway. It’s built from the same public source by GitHub Actions, and each release lists its files’ SHA-256 checksums.
          </p>,
        ],
        [
          "macOS",
          <p>Signed with our Apple Developer ID and notarized by Apple.</p>,
        ],
        [
          "Linux",
          <p>
            The AppImage and .deb come from the same build and are published with SHA-256 checksums and update signatures on the{" "}
            <a className="underline" href={`${REPO}/releases`}>releases page</a>.
          </p>,
        ],
        [
          "Team roles",
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Committers and reviewers: <a className="underline" href={PERSON}>Hüseyin Sezer Yıldırım</a>. Changes from anyone else are reviewed before they
              are merged.
            </li>
            <li>
              Approvers: <a className="underline" href={PERSON}>Hüseyin Sezer Yıldırım</a>. Every release is approved by hand before it is signed.
            </li>
          </ul>,
        ],
        [
          "Privacy",
          <p>
            Umi doesn’t send your recordings anywhere unless you ask it to: sharing a link uploads that recording to Umi Cloud. Besides that, the app
            checks for updates on GitHub, downloads the on-device AI models (captions, voice, background removal) from Hugging Face the first time you
            use them, and fetches backgrounds and music from Pexels and the Internet Archive when you browse them. See the{" "}
            <a className="underline" href="/privacy">Privacy Policy</a>.
          </p>,
        ],
      ]}
    />
  );
}
