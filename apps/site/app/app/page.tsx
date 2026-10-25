import type { Metadata } from "next";
import { Workspace } from "@/components/Workspace";

export const metadata: Metadata = { title: "Record · Umi" };

export default function Page() {
  return <Workspace />;
}
