import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { DomainFilterProvider } from "@/components/domain-filter";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <DomainFilterProvider>
      <AppShell email={session.email}>{children}</AppShell>
    </DomainFilterProvider>
  );
}
