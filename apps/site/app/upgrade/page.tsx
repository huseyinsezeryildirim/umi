import type { Metadata } from "next";
import { Upgrade } from "@/components/Upgrade";

export const metadata: Metadata = { title: "Upgrade to Pro · Umi" };

export default function Page() {
  return <Upgrade />;
}
