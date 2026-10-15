import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "luma.accountNumber";

export function formatAccountNumber(digits: string): string {
  return digits.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1-");
}

export function generateAccountNumber(): string {
  const values = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(values, (value) => String(value % 10)).join("");
}

export function useSession() {
  const [accountNumber, setAccountNumber] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setAccountNumber(event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const logIn = useCallback((value: string) => {
    localStorage.setItem(STORAGE_KEY, value);
    setAccountNumber(value);
  }, []);

  const logOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setAccountNumber(null);
  }, []);

  return { accountNumber, logIn, logOut };
}
