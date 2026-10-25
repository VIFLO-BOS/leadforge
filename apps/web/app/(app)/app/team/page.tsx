import type { Metadata } from "next";
import { TeamPage } from "@/components/app/team/team-page";

export const metadata: Metadata = { title: "Team Members" };

export default function Page() {
  return <TeamPage />;
}
