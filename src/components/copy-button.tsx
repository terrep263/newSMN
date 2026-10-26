import { useState } from "react";

/** Copies text to the clipboard and says so for a couple of seconds. */
export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Older mobile browsers without the async clipboard API.
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`shrink-0 rounded-full border border-black/15 bg-white px-3 py-1.5 text-[0.7rem] font-semibold text-ink-soft transition hover:border-brand hover:text-brand ${className}`}
      aria-live="polite"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
