import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatAccountNumber } from "../session";
import { CopyIcon, EyeIcon, Screen } from "../ui";

export function AccountScreen({
  accountNumber,
  onLogOut,
}: {
  accountNumber: string;
  onLogOut: () => void;
}) {
  const deleteAccount = useMutation(api.accounts.remove);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    const confirmed = window.confirm(
      "Delete this account? Phones using it will stop syncing. Apps already installed stay on the phone.",
    );
    if (!confirmed) return;
    try {
      await deleteAccount({ accountNumber });
      onLogOut();
    } catch {
      setError("Unable to delete the account.");
    }
  }

  return (
    <Screen title="Account" backTo="/" centered>
      <div className="form">
        <div className="field-group">
          <span className={revealed ? "field field-static" : "field field-static field-blurred"}>
            {formatAccountNumber(accountNumber)}
          </span>
          <button
            className="field-button"
            aria-label={revealed ? "Hide account number" : "Show account number"}
            onClick={() => setRevealed(!revealed)}
          >
            <EyeIcon crossed={!revealed} />
          </button>
          <button
            className="field-button"
            aria-label="Copy account number"
            onClick={() => navigator.clipboard.writeText(accountNumber)}
          >
            <CopyIcon />
          </button>
        </div>
        <button className="button" onClick={onLogOut}>
          Log out
        </button>
        {error !== null && <p className="error">{error}</p>}
        <nav className="links">
          <button className="link-button" onClick={confirmDelete}>
            Delete account
          </button>
          <a href="#/privacy">Privacy Policy</a>
        </nav>
      </div>
    </Screen>
  );
}
