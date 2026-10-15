import { useState, type FormEvent } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatAccountNumber } from "../session";
import { Screen } from "../ui";

export function LoginScreen({ onLogIn }: { onLogIn: (accountNumber: string) => void }) {
  const convex = useConvex();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 16) {
      setError("Enter a 16-digit account number.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (await convex.query(api.accounts.exists, { accountNumber: digits })) {
        onLogIn(digits);
      } else {
        setError("That account number was not found.");
      }
    } catch {
      setError("Unable to reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen centered>
      <form className="form" onSubmit={submit}>
        <input
          className="field"
          inputMode="numeric"
          autoComplete="off"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          aria-label="Account number"
          value={value}
          onChange={(event) => {
            setValue(formatAccountNumber(event.target.value));
            setError(null);
          }}
          autoFocus
        />
        <button className="button" type="submit" disabled={submitting}>
          Login
        </button>
        {error !== null && <p className="error">{error}</p>}
        <nav className="links">
          <a href="#/create">Create account</a>
          <a href="#/help">Help</a>
          <a href="#/privacy">Privacy Policy</a>
        </nav>
      </form>
    </Screen>
  );
}
