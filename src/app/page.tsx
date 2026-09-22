import { Home } from "@/components/storefront";
import { products } from "@/server/catalog";
import { storeData } from "@/server/store";
export const metadata = { alternates: { canonical: "/" } };
export default async function Page() {
  return <Home products={await products()} data={await storeData()} />;
}
