"use client";

import { ReactNode, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

// Always provide a ConvexProvider so `useQuery` can be called from any client component.
// At build time `NEXT_PUBLIC_CONVEX_URL` may be unset — fall back to a placeholder URL
// (the client object exists but won't connect; queries just return undefined).
// At runtime, set `NEXT_PUBLIC_CONVEX_URL` in env for real data.
const PLACEHOLDER_URL = "https://placeholder-not-connected.convex.cloud";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL || PLACEHOLDER_URL;
    return new ConvexReactClient(url);
  }, []);

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
