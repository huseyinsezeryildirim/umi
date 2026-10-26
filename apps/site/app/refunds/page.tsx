import type { Metadata } from "next";
import { LegalPage } from "@/components/Legal";

export const metadata: Metadata = { title: "Refund Policy · Umi", description: "How cancelling and refunds work for Umi Pro." };

const CONTACT = "hi@ux.center";

export default function Page() {
  return (
    <LegalPage
      title="Refund Policy"
      updated="October 26, 2026"
      intro={
        <p>
          Umi is free to download and use. This policy covers Umi Pro, the paid subscription for Umi Cloud. Purchases are processed by Paddle.com, our
          reseller and merchant of record, so refunds are paid out by Paddle to the card or account you paid with.
        </p>
      }
      sections={[
        [
          "14-day money-back guarantee",
          <p>
            If Umi Pro isn’t right for you, ask for a refund within 14 days of a payment, the first one or a renewal, and you get that payment back in full.
            No questions asked. Write to <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> from the email on your account, or reply to the
            receipt Paddle sent you.
          </p>,
        ],
        [
          "Cancelling",
          <p>
            You can cancel at any time from your account (Account → Manage subscription). Pro stays on until the end of the period you paid for and
            doesn’t renew. After that your account is on the free plan: your recordings on your computer are untouched, and your share links stay up for 30
            more days so you can download or move them.
          </p>,
        ],
        [
          "After 14 days",
          <p>
            Payments older than 14 days aren’t refunded, except where the law gives you a right to one, or if we remove a paid feature you rely on, in
            which case we refund the unused part of your period.
          </p>,
        ],
        [
          "How long it takes",
          <p>Refunds are usually processed within 5 business days. Your bank may take a few more days to show it.</p>,
        ],
        [
          "Contact",
          <p>
            Hüseyin Sezer Yıldırım (sole proprietorship), Akfırat Mah. 43. Sk., 34959 Tuzla, İstanbul, Türkiye,{" "}
            <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>,
        ],
      ]}
    />
  );
}
