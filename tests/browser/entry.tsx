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
else page = <Information page={path[0]} data={data} />;
createRoot(document.getElementById("root")!).render(
  <Shell locale={locale} data={data}>
    {page}
  </Shell>,
);
