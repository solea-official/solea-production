import { cache } from "react";
import { publicSettings, content } from "./catalog";
import { pool } from "./db";
import type { StoreData } from "@/lib/types";
export const storeData = cache(async (): Promise<StoreData> => ({
  settings: await publicSettings(),
  content: await content(),
  categories: (await pool.query("SELECT * FROM categories ORDER BY name_en"))
    .rows,
}));
