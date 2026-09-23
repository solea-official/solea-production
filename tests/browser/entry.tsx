import React from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "../../src/components/provider";
import {
  Home,
  Catalog,
  ProductDetail,
  Ingredients,
  Information,
} from "../../src/components/storefront";
import {
  CartPage,
  Checkout,
  OrderSuccess,
  Tracking,
} from "../../src/components/checkout";
import { Admin, Login } from "../../src/components/admin";
import { AccountAuth, AccountCenter } from "../../src/components/account";
import { Product, StoreData, Locale } from "../../src/lib/types";
declare global {
  interface Window {
    fixture: {
      products: Product[];
      data: StoreData;
      locale: Locale;
      user: { email: string; permissions: string[] } | null;
    };
  }
}
const { products, data, locale, user } = window.fixture,
  path = location.pathname.slice(1).split("/");
let page: React.ReactNode;
if (path[0] === "admin")
  page =
    path.length === 1 ? (
      <Login />
    ) : user ? (
      <Admin path={path.slice(1)} user={user} />
    ) : (
      <Login />
    );
else if (!path[0]) page = <Home products={products} data={data} />;
else if (path[0] === "products")
  page =
    path.length === 1 ? (
      <Catalog products={products} data={data} />
    ) : (
      <ProductDetail
        product={products.find((p) => p.slug === path[1])!}
        data={data}
      />
    );
else if (path[0] === "ingredients") page = <Ingredients />;
else if (path[0] === "cart") page = <CartPage />;
else if (path[0] === "checkout") page = <Checkout data={data} />;
else if (path[0] === "order-success") page = <OrderSuccess />;
else if (path[0] === "track-order") page = <Tracking />;
else if (path[0] === "account") {
  if (path[1] === "login") page = <AccountAuth mode="login" />;
  else if (path[1] === "register") page = <AccountAuth mode="register" />;
  else if (path[1] === "forgot") page = <AccountAuth mode="forgot" />;
  else if (path[1] === "reset") page = <AccountAuth mode="reset" />;
  else if (path[1] === "orders" && path[2]) page = <AccountCenter section="order" orderId={path[2]} />;
  else if (path[1] === "orders") page = <AccountCenter section="orders" />;
  else if (path[1] === "addresses") page = <AccountCenter section="addresses" />;
  else if (path[1] === "profile") page = <AccountCenter section="profile" />;
  else if (path[1] === "security") page = <AccountCenter section="security" />;
  else page = <AccountCenter section="dashboard" />;
}
else page = <Information page={path[0]} data={data} />;
createRoot(document.getElementById("root")!).render(
  <Shell locale={locale} data={data}>
    {page}
  </Shell>,
);
