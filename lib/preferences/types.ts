export type Preferences = {
  sidebarCollapsed?: boolean;
  activeTab?: "board" | "roadmap" | "timeline" | "workload";
  layoutDensity?: "compact" | "comfortable" | "spacious";
  boardSort?: "created" | "updated" | "manual";
  roadmapZoom?: "day" | "week" | "month" | "quarter";
  filters?: Record<
    string,
    {
      mine?: boolean;
      ownerIds?: string[];
      types?: string[];
    }
  >;
};
