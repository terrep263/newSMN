import { Outlet, createFileRoute } from "@tanstack/react-router";

// `/vendor` is a layout so the public For Vendors page (`vendor/index.tsx`) and
// every vendor screen (signup, login, dashboard, deals, redeem) share the same
// parent route.
export const Route = createFileRoute("/vendor")({
  component: () => <Outlet />,
});
