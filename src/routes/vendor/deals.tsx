import { Outlet, createFileRoute } from "@tanstack/react-router";

// Layout for `/vendor/deals` and everything under it.
export const Route = createFileRoute("/vendor/deals")({
  component: () => <Outlet />,
});
