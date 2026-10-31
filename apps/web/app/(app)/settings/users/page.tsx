"use client";

import { useAppConfig } from "@/components/app-config";
import { Users } from "@/components/settings/admin";
import { NoAccess, SectionHeader } from "@/components/settings/section";

export default function UsersSettings() {
  const { role, homeOffice } = useAppConfig();
  return (
    <>
      <SectionHeader
        title="Users & roles"
        subtitle={
          role === "SUPER_ADMIN"
            ? "Accounts of every office and their roles. Each user keeps their own personal settings."
            : `Accounts of ${homeOffice ?? "your office"} (office admin). Each user keeps their own personal settings.`
        }
      />
      {role === "ADMIN" || role === "SUPER_ADMIN" ? <Users /> : <NoAccess who="admins" />}
    </>
  );
}
