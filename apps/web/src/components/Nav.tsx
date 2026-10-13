"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/", label: "Luces" },
  { href: "/agenda", label: "Agenda" },
  { href: "/plano", label: "Plano" },
  { href: "/camaras", label: "Cámaras" },
  { href: "/salud", label: "Salud" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="mb-8 flex items-center justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-amber-glow/80">Alonso Home</p>
        <h1 className="text-xl font-semibold text-stone-50">Ocupación</h1>
      </div>
      <nav className="flex flex-wrap items-center justify-end gap-1 rounded-full bg-ink-800 p-1 text-sm">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-full px-2.5 py-1.5 sm:px-3 ${active ? "bg-ink-700 text-white" : "text-stone-400"}`}
            >
              {link.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => void logout()} className="rounded-full px-2.5 py-1.5 text-stone-500 sm:px-3">
          Salir
        </button>
      </nav>
    </header>
  );
}
