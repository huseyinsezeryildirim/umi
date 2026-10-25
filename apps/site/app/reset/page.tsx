import type { Metadata } from "next";
import { ResetForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "New password · Umi" };

export default function Page() {
  return <ResetForm />;
}
