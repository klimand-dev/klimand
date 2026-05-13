import type { ReactElement } from "react";
import { Terminal } from "@/components/tool-ui/terminal/terminal";
import type { TerminalProps } from "@/components/tool-ui/terminal/schema";
import { ProviderBrand, type ProviderId } from "@/components/provider-brand";

export interface TerminalToolCardProps extends TerminalProps {
  provider: ProviderId;
  workspace?: string;
  status?: "pending" | "running" | "done" | "failed" | "cancelled";
  onCancel?: () => void;
  cancelInFlight?: boolean;
}

export function TerminalToolCard(props: TerminalToolCardProps): ReactElement {
  const { provider, workspace, status, onCancel, cancelInFlight, ...terminalProps } = props;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <ProviderBrand
        provider={provider}
        workspace={workspace}
        status={status}
        onCancel={onCancel}
        cancelInFlight={cancelInFlight}
      />
      <Terminal {...terminalProps} />
    </div>
  );
}
