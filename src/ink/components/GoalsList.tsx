import React from "react";
import { Box, Text } from "ink";
import type { GoalThreadView } from "../adapter.js";

const STATUS_COLOR: Record<string, string> = {
  active: "yellow",
  done: "green",
  blocked: "magenta",
  failed: "red",
  stopped: "gray"
};

export function GoalsList(props: {
  goals: GoalThreadView[];
  selectedIndex: number;
}): React.ReactElement {
  const { goals, selectedIndex } = props;
  return (
    <Box flexDirection="column" width={36} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Goals ({goals.length})</Text>
      <Box flexDirection="column" marginTop={1}>
        {goals.length === 0 ? (
          <Text color="gray">no goals yet</Text>
        ) : (
          goals.map((goal, i) => {
            const selected = i === selectedIndex;
            const status = goal.status;
            return (
              <Box key={goal.goalId} flexDirection="column">
                <Text color={selected ? "cyan" : undefined} inverse={selected}>
                  {selected ? "› " : "  "}
                  {goal.title}
                </Text>
                <Text color={STATUS_COLOR[status] ?? "white"}>
                  {"    "}
                  {status} · cycle {goal.cycle}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
