import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatAccountNumber, generateAccountNumber } from "../session";
import { navigate } from "../router";
import { CopyIcon, Screen } from "../ui";
import type { CaptchaPayload } from "../../convex/captcha";
import { Captcha } from "../Captcha";

export function CreateAccountScreen({ onLogIn }: { onLogIn: (accountNumber: string) => void }) {
  const createAccount = useMutation(api.accounts.create);
  const [accountNumber, setAccountNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaPayload | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  async function create() {
    if (captcha === null) {
      setError("Confirm you are not a robot.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      setAccountNumber(await createAccount({ accountNumber: generateAccountNumber(), captcha }));
    } catch {
      setError("Unable to create an account. Try again.");
      // Each captcha works once.
      setCaptcha(null);
      setCaptchaKey((key) => key + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen title="Create Account" backTo="/" centered>
      <div className="form">
        {accountNumber === null ? (
          <>
            <p className="muted">
              An account is identified only by a random 16-digit number. Keep it safe: anyone with
              the number can change your tools, and it cannot be recovered.
            </p>
            <Captcha key={captchaKey} onChange={setCaptcha} />
            <button className="button" onClick={create} disabled={submitting}>
              Generate account number
            </button>
          </>
        ) : (
          <>
            <div className="field-group">
              <span className="field field-static">{formatAccountNumber(accountNumber)}</span>
              <button
                className="field-button"
                aria-label="Copy account number"
                onClick={() => navigator.clipboard.writeText(accountNumber)}
              >
                <CopyIcon />
              </button>
            </div>
            <p className="muted">Enter this number in Luma on your phone to connect it.</p>
            <button
              className="button"
              onClick={() => {
                onLogIn(accountNumber);
                navigate("/");
              }}
            >
              Continue
            </button>
          </>
        )}
        {error !== null && <p className="error">{error}</p>}
      </div>
    </Screen>
  );
}
