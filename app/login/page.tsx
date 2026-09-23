import { Shell } from "@/components/Shell";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Shell active="/">
      <LoginForm />
    </Shell>
  );
}
