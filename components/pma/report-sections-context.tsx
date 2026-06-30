"use client";

import { createContext, useContext, useState } from "react";

import type { ReportSectionKey } from "@/lib/pma/report-sections";
import type { ReportLength } from "@/lib/pma/report-settings";

// Shared state for the run config (report sections + length + custom focus) so
// the Run button (in the header) and the config fieldset (below the
// Documents-folder control) can live in different parts of the page yet drive the
// same combination — all of it posted with the run, which also persists it.

type SectionsState = Record<ReportSectionKey, boolean>;

type ReportSectionsValue = {
  sections: SectionsState;
  toggleSection: (key: ReportSectionKey) => void;
  setAll: (on: boolean) => void;
  // 0143 — synthesis verbosity + the workspace's standing custom focus.
  reportLength: ReportLength;
  setReportLength: (length: ReportLength) => void;
  customPrompt: string;
  setCustomPrompt: (text: string) => void;
};

const ReportSectionsContext = createContext<ReportSectionsValue | null>(null);

export function ReportSectionsProvider({
  initialSections,
  initialReportLength = "medium",
  initialCustomPrompt = "",
  children,
}: {
  initialSections: SectionsState;
  initialReportLength?: ReportLength;
  initialCustomPrompt?: string;
  children: React.ReactNode;
}) {
  const [sections, setSections] = useState<SectionsState>(initialSections);
  const [reportLength, setReportLength] =
    useState<ReportLength>(initialReportLength);
  const [customPrompt, setCustomPrompt] = useState<string>(initialCustomPrompt);
  const toggleSection = (key: ReportSectionKey) =>
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  // All / None quick-set: flip every known key to the same value.
  const setAll = (on: boolean) =>
    setSections((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next) as ReportSectionKey[]) next[key] = on;
      return next;
    });
  return (
    <ReportSectionsContext.Provider
      value={{
        sections,
        toggleSection,
        setAll,
        reportLength,
        setReportLength,
        customPrompt,
        setCustomPrompt,
      }}
    >
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
