import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>La Taverne de Gaming</h1>
        <p>Seuls les maîtres des lieux peuvent commander les bardes.</p>
        <form
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="discord-btn">
            Entrer avec Discord
          </button>
        </form>
      </div>
    </div>
  );
}
