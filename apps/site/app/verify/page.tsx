import type { Metadata } from "next";
import { VerifyPage } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Confirm email · Umi" };

export default function Page() {
  return <VerifyPage />;
}
