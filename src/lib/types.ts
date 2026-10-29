export type Locale = "ar" | "en";
export type Product = {
  id: string;
  sku: string;
  slug: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  volume: string;
  category_id: string | null;
  price: number | null;
  status: string;
  stock: number;
  usage_en: string;
  usage_ar: string;
  warnings_en: string;
  warnings_ar: string;
  seo_title: string;
  seo_description: string;
  images: {
    id: string;
    url: string;
    alt_en: string;
    alt_ar: string;
    position: number;
  }[];
};
export type Content = {
  key: string;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
  published: boolean;
};
export type Settings = {
  enabled: boolean;
  cod_enabled: boolean;
  phone: string;
  instagram: string;
  shipping_zones: {
    governorate: string;
    zone: string;
    fee: number;
    active: boolean;
  }[];
  free_shipping_threshold: number | null;
  instapay: { enabled: boolean; account: string; qrUrl: string };
  vodafoneCash: { enabled: boolean; number: string; qrUrl: string };
  paymob: { enabled: boolean };
};
export type StoreData = {
  settings: Settings;
  content: Content[];
  categories: { id: string; name_en: string; name_ar: string; slug: string }[];
};
export type CartItem = {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  volume: string;
  price: number | null;
  quantity: number;
  stock: number;
  status: string;
  image: string;
};
export type Cart = {
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  valid: boolean;
};
