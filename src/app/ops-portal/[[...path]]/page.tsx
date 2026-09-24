import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { Suspense } from "react";
import { Admin, Login } from "@/components/admin";
import { admin } from "@/server/security";

export const metadata = {
  title: "Operations",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const path = (await params).path || [];
  if (!path.length)
    return (
      <Suspense>
        <Login />
      </Suspense>
    );
  const resources = [
    "dashboard",
    "products",
    "orders",
    "customers",
    "content",
    "settings",
    "audit",
    "coupons",
    "users",
    "jobs",
    "security",
  ];
  if (!resources.includes(path[0])) notFound();
  const request = new NextRequest(
    (process.env.APP_URL || "http://localhost:3000") + "/ops-portal",
    { headers: await headers() },
  );
  let auth;
  try {
    auth = await admin(
      request,
      path[0] === "dashboard"
        ? undefined
        : path[0] === "jobs"
          ? "settings"
          : path[0] === "security"
            ? "users"
            : path[0],
    );
  } catch {
    redirect("/ops-portal");
  }
  return <Admin path={path} user={auth.user} />;
}
