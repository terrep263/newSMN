import { Outlet, createFileRoute } from "@tanstack/react-router";

// `/deals` is a layout so `/deals/<slug>` can nest under it. The listing itself
// lives in deals.index.tsx and the deal page in deals.$slug.tsx.
export const Route = createFileRoute("/deals")({
  component: () => <Outlet />,
});
