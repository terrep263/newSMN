// Static Lake County taxonomy — cities and categories shared by every page.
// Safe to import from both client and server code (no node-only APIs).

export const SITE = {
  name: "Shop My Neighborhood",
  county: "Lake County, FL",
  email: "lake@shopmyneighborhood.com",
  phone: "321-204-4087",
  phoneHref: "tel:+13212044087",
  tagline: "Support local. Shop your neighborhood.",
} as const;

export type Category = {
  slug: string;
  name: string;
  short: string;
  icon: string; // key into <CategoryIcon>
};

// The 10 categories from the live directory, in the same order, plus
// Grocery & Markets and Lodging & Vacation Rentals (owner's additions, pending
// confirmation of the 11th/12th).
export const CATEGORIES: Category[] = [
  { slug: "restaurants-cafes", name: "Restaurants & Cafés", short: "Restaurants", icon: "utensils" },
  { slug: "bars-nightlife", name: "Bars & Nightlife", short: "Bars & Nightlife", icon: "glass" },
  { slug: "health-medical", name: "Health & Medical", short: "Health", icon: "pulse" },
  { slug: "home-repair-handyman", name: "Home Repair & Handyman", short: "Home Repair", icon: "home" },
  { slug: "hair-nails-barbers", name: "Hair Nails & Barbers", short: "Hair & Nails", icon: "scissors" },
  { slug: "local-retail-boutiques", name: "Local Retail & Boutiques", short: "Local Retail", icon: "bag" },
  { slug: "auto-repair-detailing", name: "Auto Repair & Detailing", short: "Auto Repair", icon: "car" },
  { slug: "professional-services", name: "Professional Services", short: "Pro Services", icon: "briefcase" },
  { slug: "spas-massage-wellness", name: "Spas & Massage & Wellness", short: "Spas & Wellness", icon: "leaf" },
  { slug: "fitness-personal-training", name: "Fitness & Personal Training", short: "Fitness", icon: "dumbbell" },
  { slug: "grocery-markets", name: "Grocery & Markets", short: "Grocery & Markets", icon: "basket" },
  { slug: "lodging-vacation-rentals", name: "Lodging & Vacation Rentals", short: "Lodging", icon: "bed" },
];

/** Directory categories mirror the OpenStreetMap collector's stable public slugs.
 * The older CATEGORIES set above remains for the sample-deal marketplace. */
export const DIRECTORY_CATEGORIES: Category[] = [
  { slug: "restaurants-cafes", name: "Restaurants & Cafés", short: "Restaurants", icon: "utensils" },
  { slug: "bars-nightlife", name: "Bars & Nightlife", short: "Bars & Nightlife", icon: "glass" },
  { slug: "health-medical-services", name: "Health & Medical Services", short: "Health & Medical", icon: "pulse" },
  { slug: "home-repair-handyman-services", name: "Home Repair & Handyman Services", short: "Home Repair", icon: "home" },
  { slug: "hair-nails-barber-shops", name: "Hair, Nails & Barber Shops", short: "Hair & Nails", icon: "scissors" },
  { slug: "local-retail-boutiques", name: "Local Retail & Boutiques", short: "Local Retail", icon: "bag" },
  { slug: "auto-repair-detailing", name: "Auto Repair & Detailing", short: "Auto Repair", icon: "car" },
  { slug: "professional-services", name: "Professional Services", short: "Pro Services", icon: "briefcase" },
  { slug: "spas-massage-wellness", name: "Spas, Massage & Wellness", short: "Spas & Wellness", icon: "leaf" },
  { slug: "fitness-personal-training", name: "Fitness & Personal Training", short: "Fitness", icon: "dumbbell" },
  { slug: "grocery-markets", name: "Grocery & Markets", short: "Grocery", icon: "basket" },
  { slug: "lodging-vacation-rentals", name: "Lodging & Vacation Rentals", short: "Lodging", icon: "bed" },
];

export function directoryCategoryFromSlug(slug: string | undefined): Category | undefined {
  return DIRECTORY_CATEGORIES.find((category) => category.slug === slug);
}

export const CITY_NAMES = [
  "Astatula",
  "Clermont",
  "Eustis",
  "Fruitland Park",
  "Groveland",
  "Howey-in-the-Hills",
  "Lady Lake",
  "Leesburg",
  "Mascotte",
  "Minneola",
  "Montverde",
  "Mount Dora",
  "Paisley",
  "Sorrento",
  "Tavares",
  "The Villages",
  "Umatilla",
] as const;

export function citySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const CITIES = CITY_NAMES.map((name) => ({ name, slug: citySlug(name) }));

export function cityNameFromSlug(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  return CITIES.find((c) => c.slug === slug)?.name;
}

export function categoryFromSlug(slug: string | undefined): Category | undefined {
  if (!slug) return undefined;
  return CATEGORIES.find((c) => c.slug === slug);
}

export function categoryName(slug: string): string {
  return categoryFromSlug(slug)?.name ?? "Local Deals";
}

/** 4500 -> "$45" ; 4567 -> "$45.67" */
export function money(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function percentOff(priceCents: number, valueCents: number): number {
  if (valueCents <= 0) return 0;
  return Math.round(((valueCents - priceCents) / valueCents) * 100);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Ends Nov 30, 2026" — only ever rendered when a real end date exists. */
export function endLabel(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return null;
  return `Ends ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export function daysLeft(endsAt: string | null): number | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
