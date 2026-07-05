import { auth, signOut } from "@/auth";
import Dashboard from "@/components/Dashboard";

export default async function Home() {
  const session = await auth();
  const name = session?.user?.name || "Aubergiste";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>⚜ Régie des Bardes</h1>
          <span className="sub">La Taverne de Gaming</span>
        </div>
        <div className="user-chip">
          <span>🍺 {name}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="link">
              Quitter
            </button>
          </form>
        </div>
      </header>
      <Dashboard />
    </div>
  );
}
