import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdin } from "ink";
import { StateStore } from "../state.js";
import { Orchestrator } from "../orchestrator.js";
import { createDashboardAdapter, type DashboardAdapter, type GoalThreadView } from "./adapter.js";
import { GoalsList } from "./components/GoalsList.js";
import { GoalView } from "./components/GoalView.js";

function App(props: { adapter: DashboardAdapter; store: StateStore }): React.ReactElement {
  const { adapter, store } = props;
  const [goals, setGoals] = useState<GoalThreadView[]>(() => adapter.listGoals());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();

  useEffect(() => {
    const refresh = () => {
      setGoals(adapter.listGoals());
      setTick((t) => t + 1);
    };
    const unsub = adapter.subscribe(refresh);
    const interval = setInterval(refresh, 500);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [adapter]);

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelectedIndex((i) => Math.min(Math.max(0, goals.length - 1), i + 1));
      if (input === "s") {
        const goal = goals[selectedIndex];
        if (goal && goal.status === "active") {
          store.updateGoalStatus(goal.goalId, "stopped");
          setGoals(adapter.listGoals());
        }
      }
      if (input === "r") {
        const goal = goals[selectedIndex];
        if (goal && (goal.status === "blocked" || goal.status === "stopped")) {
          store.updateGoalStatus(goal.goalId, "active");
          setGoals(adapter.listGoals());
        }
      }
    },
    { isActive: isRawModeSupported === true }
  );

  const selected = goals[selectedIndex] ?? null;
  // Refresh the selected goal's details on every tick so step changes appear.
  const detailed = useMemo(() => {
    if (!selected) return null;
    return adapter.getGoal(selected.goalId);
  }, [selected, tick, adapter]);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">Klimand dashboard</Text>
        <Text color="gray">    ↑/↓ select  ·  r resume  ·  s stop  ·  q quit</Text>
      </Box>
      <Box marginTop={1}>
        <GoalsList goals={goals} selectedIndex={selectedIndex} />
        <Box marginLeft={1} flexGrow={1}>
          <GoalView goal={detailed} />
        </Box>
      </Box>
    </Box>
  );
}

export async function renderDashboard(deps: { store: StateStore; orchestrator?: Orchestrator }): Promise<void> {
  const adapter = createDashboardAdapter(deps);
  const instance = render(<App adapter={adapter} store={deps.store} />);
  await instance.waitUntilExit();
}
