"use client";

import { useAppConfig } from "@/components/app-config";
import { RulesEditor } from "@/components/settings/admin";
import { NoAccess, SectionHeader } from "@/components/settings/section";

export default function ClassificationSettings() {
  const { role } = useAppConfig();
  return (
    <>
      <SectionHeader
        title="Classification rules"
        subtitle="Decide which alarms are DOWN, POWER or OTHER (applies to every office)."
      />
      {role === "SUPER_ADMIN" ? <RulesEditor /> : <NoAccess />}
    </>
  );
}
