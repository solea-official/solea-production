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
export function Botanical({ kind }: { kind: string }) {
  const drawings: Record<string, React.ReactNode> = {
    aloe: (
      <path d="M50 95C33 63 23 40 20 18c22 19 29 45 30 77Zm0 0C46 60 50 31 65 12c3 29-2 57-15 83Zm0 0c11-37 26-53 38-60-2 27-18 45-38 60Z" />
    ),
    orange: (
      <>
        <circle cx="46" cy="67" r="27" />
        <path d="M46 40c-2-13 2-23 10-28m-9 21C61 17 78 18 86 23 73 37 60 39 47 33M31 54c-6 6-8 15-5 21" />
      </>
    ),
    rose: (
      <>
        <path d="M50 99V57m0 21C26 61 17 70 19 75c7 13 22 15 31 3m0 15c8-18 27-25 32-18-4 14-18 19-32 18" />
        <path d="M31 55C14 41 22 22 35 24 42 5 65 10 68 23c21-1 21 23 7 30-12 15-32 15-44 2Zm9-7c-12-19 9-31 20-14 10 14-8 24-20 14Z" />
      </>
    ),
    melissa: (
      <path d="M50 100 54 17M51 73C24 78 11 62 19 48c19-2 33 10 32 25Zm2-24c22 8 33-9 27-24-18 2-27 10-27 24Zm0-17C33 41 23 27 28 14c17 0 25 12 25 18Z" />
    ),
    myrtle: (
      <>
        <path d="m43 102 17-90M47 80C22 76 20 60 23 55c19 3 22 16 24 25Zm5-20c22-1 28-16 26-25-16 0-27 16-26 25Zm4-21C36 37 29 25 32 18c16 2 23 12 24 21Z" />
        <circle cx="66" cy="20" r="4" />
      </>
    ),
    thyme: (
      <>
        <path d="m47 103 8-86m-5 61 24-32M51 63 31 33m17 58L24 65M54 34c-15-1-17-9-13-12 9-1 11 5 13 12Zm-1 15c14-1 17-8 14-12-8-1-13 6-14 12ZM31 74c-13 1-16-5-14-9 8-3 11 4 14 9Z" />
        <circle cx="55" cy="14" r="3" />
      </>
    ),
    drop: (
      <>
        <path d="M50 12C40 38 22 53 22 71a28 28 0 0 0 56 0c0-18-18-33-28-59Z" />
        <path d="M33 68c-2 11 4 19 14 20" />
      </>
    ),
  };
  return (
    <svg
      className="botanical-art"
      viewBox="0 0 100 115"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {drawings[kind]}
    </svg>
  );
}
