// DEMO SEED DATA — every vendor below is fictional and prefixed "Sample —".
// is_sample = 1 makes the UI show a "Sample deal" badge. Nothing here is a real
// Lake County business, and no price, limit or term is attributed to one.

export type SeedDeal = {
  slug: string;
  title: string;
  vendor_name: string;
  vendor_city: string;
  category_slug: string;
  description: string;
  highlights: string[];
  fine_print: string;
  price_cents: number;
  value_cents: number;
  voucher_limit: number;
  vouchers_sold: number;
  image_hint: string;
  /** days from seed time until the deal ends; null = no end date */
  ends_in_days: number | null;
};

const STANDARD_FINE_PRINT =
  "Voucher valid for 12 months from purchase date. One voucher may be used per visit. " +
  "Not valid with other offers, coupons or discount programs. Cannot be combined with holiday specials. " +
  "Reservation recommended and subject to availability. Tax and gratuity are not included unless stated. " +
  "No cash value and no cash back. Voucher must be presented (printed or on your phone) at the time of service.";

export const SEED_DEALS: SeedDeal[] = [
  {
    slug: "sample-lakeside-coffee-co-10-coffee-drinks",
    title: "$9 for $18 of Coffee, Pastries and Cold Brew",
    vendor_name: "Sample — Lakeside Coffee Co.",
    vendor_city: "Clermont",
    category_slug: "restaurants-cafes",
    description:
      "A neighborhood coffee bar two blocks from the lake. Use this voucher for any espresso drinks, cold brew or bakery case item — drip coffee to a full breakfast sandwich.",
    highlights: [
      "$9 for $18 of coffee, cold brew and pastries",
      "Any espresso drink, including seasonal specials",
      "Bakery case included — croissants, muffins, scones",
      "Valid any day, including weekends",
    ],
    fine_print: STANDARD_FINE_PRINT,
    price_cents: 900,
    value_cents: 1800,
    voucher_limit: 300,
    vouchers_sold: 64,
    image_hint: "coffee",
    ends_in_days: 24,
  },
  {
    slug: "sample-donnelly-alley-taproom-20-for-40",
    title: "$20 for $40 of Craft Beer, Wine and Small Plates",
    vendor_name: "Sample — Donnelly Alley Taproom",
    vendor_city: "Mount Dora",
    category_slug: "bars-nightlife",
    description:
      "A small taproom off the main strip with local Florida taps and a short snack menu. The voucher covers drinks and food on the same tab.",
    highlights: [
      "$20 for $40 toward your tab",
      "Local Florida brews on tap",
      "Small plates and shareables included",
      "Good for groups — one voucher per table",
    ],
    fine_print: STANDARD_FINE_PRINT + " Must be 21 or older; valid ID required for alcohol.",
    price_cents: 2000,
    value_cents: 4000,
    voucher_limit: 150,
    vouchers_sold: 31,
    image_hint: "taproom",
    ends_in_days: 12,
  },
  {
    slug: "sample-lake-ridge-dental-new-patient-visit",
    title: "$79 for a New-Patient Exam, X-Rays and Routine Cleaning ($220 value)",
    vendor_name: "Sample — Lake Ridge Dental Studio",
    vendor_city: "Leesburg",
    category_slug: "health-medical",
    description:
      "A new-patient package: comprehensive exam, a set of bitewing X-rays, and a routine cleaning with a hygienist.",
    highlights: [
      "Comprehensive dental exam with a licensed dentist",
      "Bitewing X-ray series included",
      "Routine cleaning with a hygienist",
      "New patients only",
    ],
    fine_print:
      "New patients only; one voucher per patient. Not valid for periodontal treatment, deep cleanings or restorative work. " +
      "Subject to a scheduling appointment. Voucher valid for 6 months from purchase date. Insurance may be billed separately for future treatment.",
    price_cents: 7900,
    value_cents: 22000,
    voucher_limit: 100,
    vouchers_sold: 12,
    image_hint: "dental",
    ends_in_days: null,
  },
  {
    slug: "sample-handy-neighbors-three-hours-handyman",
    title: "$99 for 3 Hours of Handyman Service ($199 value)",
    vendor_name: "Sample — Handy Neighbors Handyman Co.",
    vendor_city: "Eustis",
    category_slug: "home-repair-handyman",
    description:
      "Three hours of general household repairs with a two-person crew: drywall patches, caulking, shelving, door adjustments, fixture swaps and minor assembly.",
    highlights: [
      "3 hours of labor with a two-person crew",
      "Drywall patches, caulking and trim work",
      "Fixture swaps, shelving and furniture assembly",
      "Materials not included — quoted on site",
    ],
    fine_print:
      "Labor only; materials are billed separately at cost with your approval. Applies to general household repairs — " +
      "no electrical, plumbing or roofing permits. Service area limited to Lake County. 24-hour cancellation notice required. Valid 12 months.",
    price_cents: 9900,
    value_cents: 19900,
    voucher_limit: 200,
    vouchers_sold: 47,
    image_hint: "handyman",
    ends_in_days: 30,
  },
  {
    slug: "sample-minneola-barber-room-cut-and-beard",
    title: "$18 for a Haircut and Hot Towel Beard Trim ($30 value)",
    vendor_name: "Sample — Minneola Barber Room",
    vendor_city: "Minneola",
    category_slug: "hair-nails-barbers",
    description:
      "A classic cut with a hot towel beard trim or a line-up. Walk-ins welcome; appointments get priority.",
    highlights: [
      "Haircut of your choice",
      "Hot towel beard trim or line-up included",
      "Walk-ins welcome, appointments priority",
      "Valid for adults and kids 10+",
    ],
    fine_print: STANDARD_FINE_PRINT,
    price_cents: 1800,
    value_cents: 3000,
    voucher_limit: 250,
    vouchers_sold: 118,
    image_hint: "barber",
    ends_in_days: 9,
  },
  {
    slug: "sample-tavares-mercantile-25-for-50",
    title: "$25 for $50 of Gifts, Home Goods and Local Makers",
    vendor_name: "Sample — Downtown Tavares Mercantile",
    vendor_city: "Tavares",
    category_slug: "local-retail-boutiques",
    description:
      "A small shop of local makers: candles, kitchen goods, Lake County prints and gifts. The voucher works store-wide.",
    highlights: [
      "$25 for $50 of in-store merchandise",
      "Work from local makers and Florida artists",
      "Candles, home goods, gifts and cards",
      "Excludes gift cards",
    ],
    fine_print: STANDARD_FINE_PRINT + " Excludes gift cards and consignment items.",
    price_cents: 2500,
    value_cents: 5000,
    voucher_limit: 175,
    vouchers_sold: 22,
    image_hint: "boutique",
    ends_in_days: 20,
  },
  {
    slug: "sample-groveland-auto-detail-full-interior",
    title: "$89 for a Full Interior Detail and Hand Wash ($160 value)",
    vendor_name: "Sample — Groveland Auto Detail Works",
    vendor_city: "Groveland",
    category_slug: "auto-repair-detailing",
    description:
      "A full interior detail — vacuum, carpet and upholstery shampoo, dash and console conditioning — plus a hand wash and wheel clean.",
    highlights: [
      "Full interior vacuum and shampoo",
      "Dash, console and leather conditioning",
      "Hand wash and wheel clean",
      "Approximately 2 hours in the bay",
    ],
    fine_print:
      "By appointment only; drop-off required. Covers standard cars, SUVs and light trucks — oversized vehicles may cost extra. " +
      "Not valid for pet hair or biohazard cleanup. Valid 12 months; weekends book early.",
    price_cents: 8900,
    value_cents: 16000,
    voucher_limit: 120,
    vouchers_sold: 8,
    image_hint: "detailing",
    ends_in_days: 38,
  },
  {
    slug: "sample-lady-lake-tax-bookkeeping-hour",
    title: "$120 for a 90-Minute Small-Business Bookkeeping Session ($225 value)",
    vendor_name: "Sample — Lady Lake Tax & Bookkeeping",
    vendor_city: "Lady Lake",
    category_slug: "professional-services",
    description:
      "A working session with a bookkeeper: categorize a year of transactions, clean up a chart of accounts, or get a simple monthly close set up.",
    highlights: [
      "90 minutes with a bookkeeper",
      "Chart-of-accounts cleanup or monthly close setup",
      "QuickBooks or spreadsheet based",
      "Follow-up summary email included",
    ],
    fine_print:
      "Does not include tax preparation, tax filing or IRS representation. One business per voucher. " +
      "Bring your own login access; software subscription fees are not included. Valid 12 months from purchase.",
    price_cents: 12000,
    value_cents: 22500,
    voucher_limit: 60,
    vouchers_sold: 5,
    image_hint: "office",
    ends_in_days: null,
  },
  {
    slug: "sample-howey-wellness-75-minute-massage",
    title: "$55 for a 75-Minute Massage ($105 value)",
    vendor_name: "Sample — Howey Wellness Studio",
    vendor_city: "Howey-in-the-Hills",
    category_slug: "spas-massage-wellness",
    description:
      "A 75-minute Swedish or deep-tissue massage in a quiet two-room studio. Add-ons such as hot stones are available at the desk.",
    highlights: [
      "75 minutes (instead of the usual 60)",
      "Swedish or deep-tissue, your choice",
      "Licensed massage therapist",
      "Same-week appointments typically available",
    ],
    fine_print:
      "By appointment; 24-hour cancellation notice required or the voucher is forfeited. Not for prenatal massage or injury treatment. " +
      "Gratuity not included and appreciated. Valid 12 months from purchase date.",
    price_cents: 5500,
    value_cents: 10500,
    voucher_limit: 220,
    vouchers_sold: 89,
    image_hint: "wellness",
    ends_in_days: 16,
  },
  {
    slug: "sample-umatilla-strength-five-classes",
    title: "$39 for 5 Small-Group Strength Classes ($90 value)",
    vendor_name: "Sample — Umatilla Strength Co.",
    vendor_city: "Umatilla",
    category_slug: "fitness-personal-training",
    description:
      "Five sessions in a coached small-group strength class — barbell basics, kettlebells and conditioning. Beginners welcome; every class is coached.",
    highlights: [
      "5 coached small-group classes",
      "Beginner-friendly barbell and kettlebell work",
      "Max 10 people per class",
      "Mat and equipment included",
    ],
    fine_print:
      "New clients only. Classes must be used within 60 days of the first class. Booking through the studio's schedule is required. " +
      "Health waiver must be signed before the first class. Not transferable.",
    price_cents: 3900,
    value_cents: 9000,
    voucher_limit: 140,
    vouchers_sold: 53,
    image_hint: "fitness",
    ends_in_days: 7,
  },
  {
    slug: "sample-sorrento-farm-market-20-for-35",
    title: "$20 for $35 of Produce, Eggs and Local Honey",
    vendor_name: "Sample — Sorrento Farm Market",
    vendor_city: "Sorrento",
    category_slug: "grocery-markets",
    description:
      "A weekend market stand with Florida produce, farm eggs, local honey and fresh bread. The voucher works across the whole stand.",
    highlights: [
      "$20 for $35 at the market stand",
      "Florida produce in season",
      "Farm eggs, local honey and fresh bread",
      "Open Friday to Sunday",
    ],
    fine_print:
      "Valid Friday–Sunday only. Subject to seasonal availability; no rain checks. One voucher per visit. " +
      "Not valid on vendor-prepared food or alcohol. Valid 12 months from purchase date.",
    price_cents: 2000,
    value_cents: 3500,
    voucher_limit: 400,
    vouchers_sold: 147,
    image_hint: "market",
    ends_in_days: 27,
  },
  {
    slug: "sample-paisley-springs-cottage-two-nights",
    title: "$139 for a 2-Night Cottage Stay ($250 value)",
    vendor_name: "Sample — Paisley Springs Cottages",
    vendor_city: "Paisley",
    category_slug: "lodging-vacation-rentals",
    description:
      "Two nights in a one-bedroom cottage with a full kitchen and a screened porch, a short drive from the Ocala National Forest.",
    highlights: [
      "2 consecutive nights in a one-bedroom cottage",
      "Full kitchen and screened porch",
      "Sleeps 2 adults comfortably",
      "Close to the Ocala National Forest",
    ],
    fine_print:
      "Subject to availability; book at least 7 days ahead. Blackout dates may apply around holidays and local events. " +
      "Cleaning fee and Florida taxes are collected by the property at check-in. No pets. Two-night minimum stay.",
    price_cents: 13900,
    value_cents: 25000,
    voucher_limit: 40,
    vouchers_sold: 6,
    image_hint: "cottage",
    ends_in_days: 45,
  },
];
