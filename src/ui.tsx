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
          <button
            className="icon-button"
            aria-label={`${iconLabel} ${label}`}
            onClick={onClick}
          >
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
