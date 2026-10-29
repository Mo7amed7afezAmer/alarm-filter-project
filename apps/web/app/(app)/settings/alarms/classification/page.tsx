"use client";

import { useAppConfig } from "@/components/app-config";
import { RulesEditor } from "@/components/settings/admin";
import { NoAccess, SectionHeader } from "@/components/settings/section";

const TITLE = "Classification rules";
const SUBTITLE = "Decide which alarms are DOWN, POWER or OTHER (applies to every office).";

export default function ClassificationSettings() {
  const { role } = useAppConfig();
  return role === "SUPER_ADMIN" ? (
    <RulesEditor title={TITLE} subtitle={SUBTITLE} />
  ) : (
    <>
      <SectionHeader title={TITLE} subtitle={SUBTITLE} />
      <NoAccess />
    </>
  );
}
