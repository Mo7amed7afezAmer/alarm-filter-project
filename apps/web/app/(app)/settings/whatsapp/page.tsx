"use client";

// Settings → WhatsApp sender (every account except viewers, user request 2026-10-29): link YOUR
// OWN WhatsApp number by scanning the QR code (WhatsApp → Linked devices → Link a device), see
// whether it is connected, log it out, and your last sends (super admin: everyone's). While it
// is linked, the WhatsApp buttons of the pages show and send from it.

import { CheckCircle2, Loader2, MessageCircle, Unplug, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAppConfig } from "@/components/app-config";
import { api } from "@/components/hourly/client";
import { NoAccess, SectionHeader } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { resetWhatsAppStatus, type WhatsAppStatus } from "@/components/whatsapp";
import { formatDateTime } from "@/lib/format";

interface SendRow {
  id: number;
  userEmail: string;
  chat: string;
  chatName: string | null;
  texts: number;
  images: number;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export default function WhatsAppSettingsPage() {
  const { role, timeZone } = useAppConfig();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [sends, setSends] = useState<SendRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      // start: show a QR when no number is linked yet
      api<{ data: WhatsAppStatus }>("/api/whatsapp/status?start=1"),
      api<{ data: SendRow[] }>("/api/whatsapp/sends"),
    ]);
    setStatus((old) => {
      // linking / logging out changes what the other pages show
      if (old && old.state !== s.data.state) resetWhatsAppStatus();
      return s.data;
    });
    setSends(l.data);
  }, []);

  // poll: the QR changes every ~20 s and the state flips once the phone scans it
  useEffect(() => {
    if (role === "VIEWER") return;
    let stop = false;
    const tick = () =>
      load()
        .catch((e) => setMsg({ ok: false, text: (e as Error).message }))
        .finally(() => !stop && setTimeout(tick, 3000));
    tick();
    return () => {
      stop = true;
    };
  }, [role, load]);

  if (role === "VIEWER") return <NoAccess who="operators and admins" />;

  const logout = async () => {
    if (!confirm("Log your WhatsApp number out? Sending stops until you scan a new QR code."))
      return;
    setBusy(true);
    try {
      await api("/api/whatsapp/logout", { method: "POST" });
      setMsg({ ok: true, text: "Logged out — scan the new QR code to link a number again" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHeader
        title="WhatsApp sender"
        subtitle="Your own WhatsApp number: it posts your alarm images and updates to your saved chats. Every account links its own."
      />

      {msg && (
        <Notice tone={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}

      <Notice tone="warning">
        Use a separate number, not a personal one: this way of linking is not allowed by
        WhatsApp&apos;s terms, and WhatsApp can ban the number. The number must be a member of every
        group it sends to.
      </Notice>

      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" /> Your linked number
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!status ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : status.state === "connected" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Connected as +{status.me?.phone}
                {status.me?.name && <span className="text-slate-500">({status.me.name})</span>}
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void logout()}>
                <Unplug className="h-4 w-4" /> Log out
              </Button>
            </div>
          ) : status.state === "qr" && status.qr ? (
            <div className="flex flex-wrap items-start gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={status.qr}
                alt="WhatsApp QR code"
                className="h-60 w-60 rounded-lg bg-white p-2"
              />
              <ol className="list-decimal space-y-1.5 pl-5 text-slate-700">
                <li>Open WhatsApp on the phone of the number you send from.</li>
                <li>Settings → Linked devices → Link a device.</li>
                <li>Point the phone at this code. It refreshes by itself.</li>
              </ol>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-red-700">
              <XCircle className="h-4 w-4" />
              {status.state === "offline"
                ? "The WhatsApp sender service is not running."
                : status.state === "starting"
                  ? "Starting…"
                  : "Not linked — getting a QR code…"}
              {status.error && <span className="text-slate-500">({status.error})</span>}
            </span>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">
            {role === "SUPER_ADMIN" ? "Last sends (every account)" : "Your last sends"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {!sends ? null : !sends.length ? (
            <p className="text-slate-500">Nothing sent yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">By</th>
                    <th className="py-2 pr-4">Chat</th>
                    <th className="py-2 pr-4">Sent</th>
                    <th className="py-2">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sends.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap py-2 pr-4">
                        {formatDateTime(s.createdAt, timeZone)}
                      </td>
                      <td className="py-2 pr-4">{s.userEmail}</td>
                      <td className="max-w-xs truncate py-2 pr-4" title={s.chat}>
                        {s.chatName ?? s.chat}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4">
                        {[
                          s.texts && "text",
                          s.images && `${s.images} image${s.images === 1 ? "" : "s"}`,
                        ]
                          .filter(Boolean)
                          .join(" + ")}
                      </td>
                      <td className="py-2">
                        {s.ok ? (
                          <span className="text-emerald-700">Sent</span>
                        ) : (
                          <span className="text-red-700">{s.error ?? "Failed"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
