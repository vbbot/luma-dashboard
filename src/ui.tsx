import type { ReactNode } from "react";
import { navigate } from "./router";

const iconProps = {
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const BackIcon = () => (
  <svg {...iconProps} strokeWidth={2}>
    <path d="M15 4 7 12l8 8" />
  </svg>
);

export const PlusCircleIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 7v10M7 12h10" />
  </svg>
);

export const MinusCircleIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="10" />
    <path d="M7 12h10" />
  </svg>
);

export const EyeIcon = ({ crossed }: { crossed: boolean }) => (
  <svg {...iconProps} width={22} height={22}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {crossed && <path d="M3 3l18 18" />}
  </svg>
);

export const CopyIcon = () => (
  <svg {...iconProps} width={22} height={22}>
    <rect x="8" y="8" width="12" height="13" rx="1" />
    <path d="M16 8V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" />
  </svg>
);

export function Screen({
  title,
  backTo,
  action,
  children,
  centered = false,
}: {
  title?: string;
  backTo?: string;
  action?: { label: string; icon: ReactNode; to: string };
  children: ReactNode;
  centered?: boolean;
}) {
  return (
    <div className="screen">
      <header className="header">
        <div className="header-side">
          {backTo !== undefined && (
            <button className="icon-button" aria-label="Back" onClick={() => navigate(backTo)}>
              <BackIcon />
            </button>
          )}
        </div>
        {title !== undefined && <h1 className="title">{title}</h1>}
        <div className="header-side header-side-end">
          {action !== undefined && (
            <button
              className="icon-button"
              aria-label={action.label}
              onClick={() => navigate(action.to)}
            >
              {action.icon}
            </button>
          )}
        </div>
      </header>
      <main className={centered ? "content content-centered" : "content"}>{children}</main>
    </div>
  );
}

export function MenuLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a className="menu-item" href={`#${to}`}>
      {children}
    </a>
  );
}

export function ItemRow({
  label,
  icon,
  iconLabel,
  onClick,
  disabled = false,
}: {
  label: string;
  icon?: ReactNode;
  iconLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "item-row item-row-disabled" : "item-row"}>
      <span className="item-row-icon">
        {icon !== undefined && onClick !== undefined && (
          <button className="icon-button" aria-label={`${iconLabel} ${label}`} onClick={onClick}>
            {icon}
          </button>
        )}
      </span>
      <span className="item-row-label">{label}</span>
      <span className="item-row-icon" />
    </div>
  );
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

// --- Settings controls -------------------------------------------------------
// One set of controls for every settings-style page (Lock Screen,
// Connections), so sizes and spacing match everywhere.

export function Page({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>;
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// A list row: a title with a quieter line under it, trailing controls on the
// right, and an optional panel that opens beneath it.
export function ListRow({
  title,
  detail,
  trailing,
  onClick,
  open = false,
  children,
}: {
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  open?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={open ? "list-row list-row-open" : "list-row"}>
      <div className="list-row-main">
        <button className="list-row-text" onClick={onClick} disabled={onClick === undefined}>
          <span className="list-row-title">{title}</span>
          {detail !== undefined && <span className="list-row-detail">{detail}</span>}
        </button>
        {trailing !== undefined && <div className="list-row-trailing">{trailing}</div>}
        {onClick !== undefined && (
          <span
            className={open ? "list-row-chevron list-row-chevron-open" : "list-row-chevron"}
            aria-hidden
          >
            ›
          </span>
        )}
      </div>
      {open && children !== undefined && <div className="panel">{children}</div>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={checked ? "switch switch-on" : "switch"}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

// Typed time: "730", "0730" or "07:30" all become 07:30. No scrolling picker.
export function formatTimeInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}`;
}

export function normalTime(value: string): string | null {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

export function TimeInput({
  value,
  onChange,
  onEnter,
  label = "Time",
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  label?: string;
}) {
  return (
    <input
      className="input input-time"
      inputMode="numeric"
      placeholder="07:30"
      aria-label={label}
      maxLength={5}
      value={value}
      onChange={(event) => onChange(formatTimeInput(event.target.value))}
      onKeyDown={(event) => {
        if (event.key === "Enter" && onEnter) {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

export function Chip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="chip">
      {children}
      {onRemove && (
        <button className="chip-remove" aria-label="Remove" onClick={onRemove}>
          ✕
        </button>
      )}
    </span>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "tab tab-active" : "tab"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// The part of a server error meant for people: Convex wraps it as
// "... Uncaught Error: <message> at ...".
export function errorMessage(caught: unknown, fallback: string) {
  const text = caught instanceof Error ? caught.message : "";
  return /Uncaught Error: ([^\n]+)/.exec(text)?.[1] ?? fallback;
}
