"use client";

import { useAppConfig } from "@/components/app-config";
import { OfficePicker } from "@/components/settings/admin";
import { NoAccess, SectionHeader } from "@/components/settings/section";

export default function OfficeSettings() {
  const { role } = useAppConfig();
  return (
    <>
      <SectionHeader title="Office view" subtitle="Which office the pages show for you." />
      {role === "SUPER_ADMIN" ? <OfficePicker /> : <NoAccess />}
    </>
  );
}
