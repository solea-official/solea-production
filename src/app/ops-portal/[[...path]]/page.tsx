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
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<{ reset?: string }>;
}) {
  const path = (await params).path || [];
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
  if (path.length && !resources.includes(path[0])) notFound();
  const request = new NextRequest(
    (process.env.APP_URL || "http://localhost:3000") + "/ops-portal",
    { headers: await headers() },
  );
  let auth;
  try {
    auth = await admin(
      request,
      !path.length || path[0] === "dashboard"
        ? undefined
        : path[0] === "jobs"
          ? "settings"
          : path[0] === "security"
            ? "users"
            : path[0],
    );
  } catch {
    if (path.length) redirect("/ops-portal");
  }
  if (!auth || (!path.length && (await searchParams).reset))
    return (
      <Suspense>
        <Login />
      </Suspense>
    );
  return <Admin path={path} user={auth.user} />;
}
