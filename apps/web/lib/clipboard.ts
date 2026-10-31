/**
 * Copies plain text. navigator.clipboard needs a secure context (HTTPS or localhost) and can be
 * refused (permission, unfocused window) — then fall back to execCommand on a temporary textarea
 * (also the only way on http://<lan-ip>).
 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to execCommand
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy is not allowed in this browser");
  } finally {
    ta.remove();
  }
}
