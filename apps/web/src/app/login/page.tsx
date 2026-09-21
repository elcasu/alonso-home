import { LoginForm } from "@/components/LoginForm";
import { getSessionCookie, isSessionTokenValid } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const token = await getSessionCookie();
  if (isSessionTokenValid(token)) {
    redirect("/");
  }
  return <LoginForm />;
}
