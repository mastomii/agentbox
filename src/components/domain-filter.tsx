"use client";

import * as React from "react";

// Shared selected-domain filter between the sidebar DOMAINS list and the
// inbox list. "" = All domains.
type Ctx = { domain: string; setDomain: (d: string) => void };
const DomainFilterContext = React.createContext<Ctx | null>(null);

export function DomainFilterProvider({ children }: { children: React.ReactNode }) {
  const [domain, setDomain] = React.useState("");
  return (
    <DomainFilterContext.Provider value={{ domain, setDomain }}>
      {children}
    </DomainFilterContext.Provider>
  );
}

export function useDomainFilter() {
  const ctx = React.useContext(DomainFilterContext);
  if (!ctx) throw new Error("useDomainFilter must be used within DomainFilterProvider");
  return ctx;
}
