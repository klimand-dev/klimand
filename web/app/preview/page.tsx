import { TerminalToolCard } from "@/components/terminal-tool-card";

export default function PreviewPage(): React.ReactElement {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">Terminal tool-card preview</h1>
        <p className="text-sm text-muted-foreground">
          Phase-2 visual smoke. Each card shows the branded provider header above the @tool-ui terminal output.
        </p>
      </header>

      <TerminalToolCard
        provider="claude"
        workspace="C:\\agents\\CodexCLIAgent"
        status="running"
        id="preview-claude"
        command="claude -p 'plan the refactor'"
        cwd="C:\\agents\\CodexCLIAgent"
        exitCode={0}
        durationMs={4200}
        stdout={"reading project structure...\n found 9 source files\nreviewing types.ts...\nready to plan."}
      />

      <TerminalToolCard
        provider="codex"
        workspace="C:\\agents\\CodexCLIAgent"
        status="done"
        id="preview-codex"
        command="codex exec 'add unit tests for retry path'"
        cwd="C:\\agents\\CodexCLIAgent"
        exitCode={0}
        durationMs={18400}
        stdout={"+ tests/orchestrator.test.ts  (3 new tests)\n+ src/orchestrator.ts          (no changes)\n\n5 passed, 0 failed"}
      />

      <TerminalToolCard
        provider="claude"
        workspace="C:\\agents\\CodexCLIAgent"
        status="failed"
        id="preview-claude-error"
        command="claude -p 'verify build'"
        cwd="C:\\agents\\CodexCLIAgent"
        exitCode={2}
        durationMs={1300}
        stderr={"error: command not authenticated\nrun `claude login` first."}
      />
    </main>
  );
}
