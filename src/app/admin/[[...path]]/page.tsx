import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { NextRequest } from "next/server";
import { Suspense } from "react";
import { admin } from "@/server/security";
import { Admin, Login } from "@/components/admin";
export const metadata = {
  title: "Administration",
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
  ];
  if (!resources.includes(path[0])) notFound();
  const request = new NextRequest(
    (process.env.APP_URL || "http://localhost:3000") + "/admin",
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
          : path[0],
    );
  } catch {
    redirect("/admin");
  }
  return <Admin path={path} user={auth.user} />;
}
