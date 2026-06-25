"use client";

import { createContext, useContext, useState } from "react";

import type { ReportSectionKey } from "@/lib/pma/report-sections";

// Shared state for the report-section selection so the Run button (in the
// header) and the checkbox fieldset (below the Documents-folder control) can
// live in different parts of the page yet drive the same combination.

type SectionsState = Record<ReportSectionKey, boolean>;

type ReportSectionsValue = {
  sections: SectionsState;
  toggleSection: (key: ReportSectionKey) => void;
};

const ReportSectionsContext = createContext<ReportSectionsValue | null>(null);

export function ReportSectionsProvider({
  initialSections,
  children,
}: {
  initialSections: SectionsState;
  children: React.ReactNode;
}) {
  const [sections, setSections] = useState<SectionsState>(initialSections);
  const toggleSection = (key: ReportSectionKey) =>
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  return (
    <ReportSectionsContext.Provider value={{ sections, toggleSection }}>
      {children}
    </ReportSectionsContext.Provider>
  );
}

export function useReportSections(): ReportSectionsValue {
  const ctx = useContext(ReportSectionsContext);
  if (!ctx) {
    throw new Error(
      "useReportSections must be used within a ReportSectionsProvider",
    );
  }
  return ctx;
}
