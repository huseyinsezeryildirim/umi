import type { Metadata } from "next";
import { ForgotForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Forgot password · Umi" };

export default function Page() {
  return <ForgotForm />;
}
