import { useState } from "react";
let navigating = false;
export function useRouter() {
  return {
    replace: (url: string) => {
      navigating = true;
      window.location.replace(url);
    },
    push: (url: string) => {
      navigating = true;
      window.location.assign(url);
    },
    refresh: () => {
      if (!navigating) window.location.reload();
    },
  };
}
export function usePathname() {
  return window.location.pathname;
}
export function useSearchParams() {
  const [p] = useState(() => new URLSearchParams(window.location.search));
  return p;
}
