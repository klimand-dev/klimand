import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import path from "node:path";
import fs from "node:fs";
import type { GoalThreadView, ThreadMessageView } from "../adapter.js";

const STATUS_COLOR: Record<string, string> = {
  active: "yellow",
  done: "green",
  blocked: "magenta",
  failed: "red",
  stopped: "gray",
  running: "cyan"
};

export function GoalView(props: { goal: GoalThreadView | null }): React.ReactElement {
  const { goal } = props;
  if (!goal) {
    return (
      <Box flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">no goal selected</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold>{goal.title}</Text>
        <Text color="gray">  ·  </Text>
        <Text color={STATUS_COLOR[goal.status] ?? "white"}>{goal.status}</Text>
        <Text color="gray">  ·  cycle {goal.cycle}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {goal.messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </Box>
      {goal.runningStepArtifactsDir ? (
        <LiveTail artifactsDir={goal.runningStepArtifactsDir} />
      ) : null}
    </Box>
  );
}

function Message(props: { message: ThreadMessageView }): React.ReactElement {
  const { message } = props;
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="blue" bold>You</Text>
        <Text>  {message.text}</Text>
      </Box>
    );
  }
  const meta = message.metadata;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="magenta" bold>
          {meta?.provider ?? "agent"} · {meta?.stepRole ?? "?"}
        </Text>
        <Text color="gray">  ·  </Text>
        <Text color={STATUS_COLOR[meta?.status ?? ""] ?? "white"}>{meta?.status ?? ""}</Text>
        {meta?.attempt ? <Text color="gray">  · retry {meta.attempt}</Text> : null}
      </Box>
      <Text>{indent(message.text, 2)}</Text>
    </Box>
  );
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s.split("\n").map((line) => `${pad}${line}`).join("\n");
}

function LiveTail(props: { artifactsDir: string }): React.ReactElement {
  const [tail, setTail] = useState<string>("");
  const lastSize = useRef<number>(0);
  useEffect(() => {
    const file = path.join(props.artifactsDir, "stdout.log");
    lastSize.current = 0;
    setTail("");
    let watcher: fs.FSWatcher | null = null;
    let timer: NodeJS.Timeout | null = null;

    const refresh = () => {
      fs.stat(file, (err, stat) => {
        if (err) return;
        if (stat.size === lastSize.current) return;
        fs.readFile(file, "utf8", (rerr, content) => {
          if (rerr) return;
          lastSize.current = stat.size;
          const lines = content.split(/\r?\n/);
          setTail(lines.slice(-12).join("\n"));
        });
      });
    };

    refresh();
    try {
      watcher = fs.watch(path.dirname(file), { persistent: false }, (_e, name) => {
        if (name === "stdout.log") refresh();
      });
    } catch {
      // fall back to polling
    }
    timer = setInterval(refresh, 500);

    return () => {
      if (watcher) watcher.close();
      if (timer) clearInterval(timer);
    };
  }, [props.artifactsDir]);

  if (!tail) return <></>;
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>live stdout</Text>
      <Text dimColor>{tail}</Text>
    </Box>
  );
}
