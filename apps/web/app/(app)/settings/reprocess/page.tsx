"use client";

import { useAppConfig } from "@/components/app-config";
import { Reprocess } from "@/components/settings/admin";
import { NoAccess, SectionHeader } from "@/components/settings/section";

export default function ReprocessSettings() {
  const { role } = useAppConfig();
  return (
    <>
      <SectionHeader title="Reprocess" subtitle="Rebuild alarms from the stored emails." />
      {role === "SUPER_ADMIN" ? <Reprocess /> : <NoAccess />}
    </>
  );
}
