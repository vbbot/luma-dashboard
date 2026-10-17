import { useEffect, useState } from "react";
import type { Block, Card, Page } from "../convex/cards";

// The dashboard's copy of Luma's card renderer (docs/lockscreen-cards.md), so
// previews show what the phone will: valid pages only, paging with ‹ ›,
// times formatted against the current clock.

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function validPages(card: Card, now: number): Page[] {
  return card.pages.filter(
    (page) =>
      (page.validFrom === undefined || page.validFrom <= now) &&
      (page.validUntil === undefined || page.validUntil > now),
  );
}

export function isShowing(card: Card | null, now = Date.now()): card is Card {
  return card !== null && card.expiresAt > now && validPages(card, now).length > 0;
}

// Same wording as Luma: "in 5 min", "5 min ago", "1 h 20 min", "Now".
function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0
    ? `${minutes / 60} h`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatTime(block: Extract<Block, { type: "time" }>, now: number) {
  const minutes = Math.round((block.at - now) / 60_000);
  let text: string;
  if (block.format === "clock") {
    text = new Date(block.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (block.format === "countdown") {
    text = minutes <= 0 ? "Now" : duration(minutes);
  } else if (minutes === 0) {
    text = "now";
  } else {
    text = minutes > 0 ? `in ${duration(minutes)}` : `${duration(-minutes)} ago`;
  }
  return block.prefix ? `${block.prefix} ${text}` : text;
}

function BlockView({ block, now }: { block: Block; now: number }) {
  switch (block.type) {
    case "text":
      return (
        <p className={block.role === "secondary" ? "card-secondary" : "card-primary"}>
          {block.text}
        </p>
      );
    case "pair":
      return (
        <p className="card-primary card-pair">
          <span>{block.left}</span>
          <span>{block.right}</span>
        </p>
      );
    case "progress":
      return (
        <div className="card-progress">
          <span className="card-secondary">
            {block.label ? `${block.label} ` : ""}
            {block.value}/{block.max}
          </span>
          <span className="card-progress-track">
            <span style={{ width: `${(block.value / block.max) * 100}%` }} />
          </span>
        </div>
      );
    case "time":
      return <p className="card-primary">{formatTime(block, now)}</p>;
  }
}

export function CardPreview({ card }: { card: Card | null }) {
  const now = useNow();
  const pages = card === null ? [] : validPages(card, now);
  const [pageId, setPageId] = useState<string | undefined>(card?.paging?.start);

  if (!isShowing(card, now)) {
    return <div className="card-preview card-empty">Nothing to show</div>;
  }
  const index = Math.max(
    0,
    pages.findIndex((page) => page.id === pageId),
  );
  const page = pages[index];
  const paged = pages.length > 1;
  const step = (delta: number) =>
    setPageId(pages[(index + delta + pages.length) % pages.length].id);

  return (
    <div className="card-preview">
      {paged && (
        <p className="card-secondary">
          {card.title ? `${card.title} · ` : ""}
          {index + 1}/{card.paging?.total ?? pages.length}
        </p>
      )}
      <div className="card-row">
        {paged && (
          <button className="card-arrow" aria-label="Previous" onClick={() => step(-1)}>
            ‹
          </button>
        )}
        <div className="card-blocks">
          {page.blocks.map((block, blockIndex) => (
            <BlockView key={blockIndex} block={block} now={now} />
          ))}
        </div>
        {paged && (
          <button className="card-arrow" aria-label="Next" onClick={() => step(1)}>
            ›
          </button>
        )}
      </div>
    </div>
  );
}
