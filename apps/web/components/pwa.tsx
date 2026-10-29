"use client";

// Installable web app (PWA): registers the service worker (public/sw.js) and keeps the
// browser's install offer so the sidebar can show "Install app". Browsers only offer to install
// over HTTPS or on localhost — on plain http://<LAN IP> there is no service worker and no offer.

import { Download } from "lucide-react";
import { useEffect, useState } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** The pending install offer, shared with the button (it may fire before the sidebar mounts). */
let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Mounted once in the root layout. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    // in `next dev` the worker must not cache /_next/static (it changes on every edit)
    const url = process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";
    navigator.serviceWorker.register(url).catch(() => undefined);
    const onOffer = (e: Event) => {
      e.preventDefault();
      offer = e as InstallPrompt;
      changed();
    };
    const onInstalled = () => {
      offer = null;
      changed();
    };
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

/** Pages kept for offline use belong to the signed-in user: dropped on sign-out. */
export function clearOfflinePages(): Promise<unknown> {
  if (typeof caches === "undefined") return Promise.resolve();
  return caches
    .keys()
    .then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("pages-")).map((k) => caches.delete(k))),
    )
    .catch(() => undefined);
}

/** "Install app" in the sidebar, while the browser offers to install it. */
export function InstallAppButton({ className }: { className?: string }) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!offer) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        const o = offer;
        if (!o) return;
        await o.prompt();
        await o.userChoice.catch(() => undefined);
        offer = null;
        changed();
      }}
      className={className}
      title="Install Alarm Filter as an app on this device"
    >
      <Download className="h-4 w-4" />
      Install app
    </button>
  );
}
