"use client";

import { ReactNode, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const PLACEHOLDER_URL = "https://placeholder-not-connected.convex.cloud";

function isValidUrl(s: string | undefined): s is string {
  return !!s && /^https?:\/\//.test(s);
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_CONVEX_URL;
    const url = isValidUrl(raw) ? raw : PLACEHOLDER_URL;
    return new ConvexReactClient(url);
  }, []);

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
