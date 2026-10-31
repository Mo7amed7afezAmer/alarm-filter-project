import { redirect } from "next/navigation";

/** Settings open on the personal General section; the sidebar (layout.tsx) lists the rest. */
export default function SettingsIndex() {
  redirect("/settings/general");
}
