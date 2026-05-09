"use client";

import dynamic from "next/dynamic";

// Disable SSR for the dashboard — it relies on Convex queries that need a client URL at runtime.
const Dashboard = dynamic(() => import("./Dashboard"), { ssr: false });

export default function Home() {
  return <Dashboard />;
}
