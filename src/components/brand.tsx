import Link from "next/link";
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="SOLÉA">
      <img
        src="/media/logo.png"
        alt="SOLÉA — CARE FROM NATURE"
        width="62"
        height="70"
      />
      <span>SOLÉA</span>
    </Link>
  );
}
export function Icon({ name = "arrow" }: { name?: string }) {
  const paths: Record<string, string> = {
    arrow: "M4 12h16m-6-6 6 6-6 6",
    bag: "M5 7h14l1 14H4L5 7ZM9 8V6a3 3 0 0 1 6 0v2",
    menu: "M4 7h16M4 12h16M4 17h16",
    close: "m6 6 12 12M6 18 18 6",
    check: "m5 12 4 4L19 6",
    phone: "M6 3 3 5c0 8 8 16 16 16l2-3-5-4-2 2-6-6 2-2-4-5Z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  };
  return (
    <svg
      className={"icon " + name}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.arrow} />
    </svg>
  );
}
