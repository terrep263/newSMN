// Small inline SVG icon set — no icon package, no network requests.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  utensils: (
    <>
      <path d="M6 3v7a2 2 0 0 0 4 0V3" />
      <path d="M8 10v11" />
      <path d="M16 3c2 2 2 5 0 7v11" />
    </>
  ),
  glass: (
    <>
      <path d="M5 4h14l-7 8-7-8Z" />
      <path d="M12 12v8" />
      <path d="M8 20h8" />
    </>
  ),
  pulse: (
    <>
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </>
  ),
  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h12V10" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8 8l11 9M8 16L19 7" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  car: (
    <>
      <path d="M4 15l1.5-5A2 2 0 0 1 7.4 8.6h9.2A2 2 0 0 1 18.5 10L20 15" />
      <path d="M3 15h18v4h-3v-2H6v2H3v-4Z" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M9 7V5h6v2" />
      <path d="M3 12h18" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 4c-8 0-14 3-14 9a7 7 0 0 0 7 7c6 0 7-7 7-16Z" />
      <path d="M9 18c1-5 5-8 9-9" />
    </>
  ),
  dumbbell: (
    <>
      <path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" />
    </>
  ),
  basket: (
    <>
      <path d="M4 10h16l-1.5 9h-13L4 10Z" />
      <path d="M8 10l3-6M16 10l-3-6" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18V7M3 12h18v6" />
      <path d="M7 12V9h5v3" />
      <path d="M3 18h18" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  phone: (
    <>
      <path d="M5 3h4l2 5-3 2a11 11 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="m4 13 5 5L20 6" />,
  arrow: (
    <>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 9V6h18v3a3 3 0 0 0 0 6v3H3v-3a3 3 0 0 0 0-6Z" />
      <path d="M12 6v12" strokeDasharray="2 3" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3h10v5" />
      <rect x="4" y="8" width="16" height="8" rx="2" />
      <path d="M7 16h10v5H7z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
};

export function Icon({ name, ...props }: IconProps & { name: string }) {
  return <Base {...props}>{PATHS[name] ?? PATHS.pin}</Base>;
}

export function CategoryIcon({ slug, ...props }: IconProps & { slug: string }) {
  // Maps a category slug to its icon key.
  const map: Record<string, string> = {
    "restaurants-cafes": "utensils",
    "bars-nightlife": "glass",
    "health-medical": "pulse",
    "health-medical-services": "pulse",
    "home-repair-handyman": "home",
    "home-repair-handyman-services": "home",
    "hair-nails-barbers": "scissors",
    "hair-nails-barber-shops": "scissors",
    "local-retail-boutiques": "bag",
    "auto-repair-detailing": "car",
    "professional-services": "briefcase",
    "spas-massage-wellness": "leaf",
    "fitness-personal-training": "dumbbell",
    "grocery-markets": "basket",
    "lodging-vacation-rentals": "bed",
  };
  return <Icon name={map[slug] ?? "ticket"} {...props} />;
}
