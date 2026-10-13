import { redirect } from "next/navigation";
import { getSessionCookie, isSessionTokenValid } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const token = await getSessionCookie();
  if (!isSessionTokenValid(token)) {
    redirect("/login");
  }
  return (
    <div className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-16 pt-6">
      <Nav />
      {children}
    </div>
  );
}
