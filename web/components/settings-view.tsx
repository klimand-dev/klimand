"use client";

import { AgentProfilePanel } from "@/components/agent-profile-panel";

// Full-pane settings surface: the existing AgentProfilePanel content rendered
// at the right-pane width instead of the cramped sidebar slot. The panel's
// internal layout already handles its own scrolling.
export function SettingsView(): React.ReactElement {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <h2 className="text-sm font-semibold">Settings</h2>
        <span className="text-xs text-muted-foreground">agent profile, BYOK, schedules, doctor</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AgentProfilePanel className="h-full w-full" />
      </div>
    </div>
  );
}
