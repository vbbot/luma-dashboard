import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { CaptchaPayload } from "../../convex/captcha";
import { Captcha } from "../Captcha";
import { formatAccountNumber } from "../session";
import { Screen } from "../ui";

export function LoginScreen({ onLogIn }: { onLogIn: (accountNumber: string) => void }) {
  const logIn = useMutation(api.accounts.logIn);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaPayload | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 16) {
      setError("Enter a 16-digit account number.");
      return;
    }
    if (captcha === null) {
      setError("Confirm you are not a robot.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (await logIn({ accountNumber: digits, captcha })) {
        onLogIn(digits);
        return;
      }
      setError("That account number was not found.");
    } catch {
      setError("Unable to log in. Try again.");
    }
    // Each captcha works once.
    setCaptcha(null);
    setCaptchaKey((key) => key + 1);
    setSubmitting(false);
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
        <Captcha key={captchaKey} onChange={setCaptcha} />
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
