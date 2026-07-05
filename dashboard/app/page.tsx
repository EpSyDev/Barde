import { auth } from "@/auth";
import AppShell from "@/components/AppShell";

export default async function Home() {
  const session = await auth();
  const name = session?.user?.name || "Aubergiste";

  return <AppShell userName={name} />;
}
