import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Create your workspace", robots: { index: false } };

export default function SignUpPage() {
  return <SignUpForm />;
}
