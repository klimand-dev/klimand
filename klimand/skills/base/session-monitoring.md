---
name: session-monitoring
description: Watch a running CLI session and decide whether to keep waiting, intervene, or kill.
triggers_on: [session-running]
version: "0.1"
---

A spawned CLI session may run for minutes or hours. The orchestrator is not idle while it runs — it watches.

## Health signals

Healthy:
- New output lines arrive at a steady cadence (any time within the last few minutes).
- Output mentions activity that aligns with the sub-task (file edits, command runs, tool calls).
- Exit hasn't happened yet, but no output is stuck on a prompt or confirmation.

Unhealthy:
- **Hung waiting for input.** Output ends with a `?` or `>>>` or a known prompt pattern. The CLI is paused for user input that will never come. Action: kill, escalate as "needs user input" (the prompt should have been written to not require input).
- **Infinite-loop pattern.** The same tool call or the same error repeats more than ~5 times. Action: kill, retry with a tighter prompt naming the loop.
- **Silent stall.** No output for an unusually long stretch given the project size (e.g. >5 minutes with no signal during what should be a 30-second edit). Action: probe; if still silent after another minute, kill and re-dispatch.
- **Runaway file changes.** The session has touched far more files than the sub-task warrants (e.g. 100 file diffs for a "rename one function" sub-task). Action: kill, escalate.

## What waiting looks like

- Long-running but actively logging: keep waiting. Do not kill a test suite that takes 20 minutes.
- Goal-budget limits still apply. If wall-clock exceeds the per-goal cap (default 4h), kill regardless of health.

## Never

- Never kill a session mid-write to disk. If the CLI signals it's in the middle of a multi-file edit, wait for the next coherent boundary or hit the wall-clock cap.
- Never auto-restart killed sessions without going through `failure-diagnosis`.
