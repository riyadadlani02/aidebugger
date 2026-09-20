# aidebugger

Non-stopping runtime traps for live AI agent processes — so an AI coding agent can read **real
values** out of a running agent without freezing the agent it's debugging.

```bash
aidebugger run -- python my_agent.py          # zero code changes to the target
aidebugger trap --trapset livekit             # or: aidebugger trap pkg.mod.Class.method
aidebugger poll 0                             # JSON events, non-blocking
aidebugger inspect 160                        # expand an object one level
```

## Why not just use a debugger

[mcp-debugger](https://github.com/debugmcp/mcp-debugger), [mcp-debugpy](https://github.com/markomanninen/mcp-debugpy)
and friends already give agents debugpy breakpoints over MCP. They all **stop the world**, and an AI
system can't survive that: pause a voice agent for 30s and the LLM request times out, the session
dies, the SIP leg drops. **Pausing destroys the bug you were chasing.** Three more mismatches:

- **Non-determinism** — the bug is on call #400. Nobody is sitting at a breakpoint at 2am.
- **Async** — the interesting frames are asyncio tasks, not threads. Events carry a `task` field.
- **Vocabulary** — you want "trap every tool call", not `agent.py:412`.

aidebugger traps **capture and continue**. Built on `sys.monitoring` (PEP 669), armed per code object:

| | |
|---|---|
| Untrapped code | **0.94x** — noise |
| Trapped function | ~18ns/call — irrelevant at LLM/tool boundaries |
| Target process | never pauses, ever |

Need to actually step? Use mcp-debugger. This does the thing it can't.

## Live console

The trap server serves a console at its own port — open it while the target runs:

```bash
open "http://127.0.0.1:$(cat ${TMPDIR:-/tmp}/aidebugger.port)/"
```

A time axis that keeps advancing whether or not events arrive (the target is running the whole
time), the armed traps with hit counts, and the event stream. Click an event for its locals; click
a non-primitive to expand it from the live process.

## Trap sets

Semantic hooks instead of line numbers. Adapters are JSON data, not code.

```bash
aidebugger trap --trapset livekit --hook on-tool-call
aidebugger probe                 # which symbols resolve against what's installed
```

| Adapter | Hooks | Status |
|---|---|---|
| `livekit` | on-tool-call, on-llm-request, on-handoff, on-user-turn | **verified**, livekit-agents 1.6.6, 7/7 |
| `langchain` | on-tool-call, on-llm-request, on-handoff, on-state-write | **unverified** — written blind |
| `openai_agents` | on-tool-call, on-llm-request, on-handoff | **unverified** — written blind |

Run `aidebugger probe <name>` before trusting an unverified adapter, or after a framework upgrade.
PRs fixing symbols welcome.

## Capture safety

- **`__repr__` is never called on unknown types.** A repr can be slow, raise on a half-built object,
  or touch network state on a live session. Primitives inline; everything else gets an `objectId`
  you expand on demand, held by weakref so aidebugger never keeps your objects alive.
- **PII redaction is on by default**, applied *at capture time* — dates of birth, names, emails,
  government IDs, tokens and friends never enter the buffer an LLM reads. Widen with `--redact`.
- **Drops are reported.** `poll` returns `dropped`; a tool that silently loses events while implying
  full coverage is worse than no tool.
- **Redaction is key-based, not value-based.** A PII-shaped key is caught; a DOB buried inside a
  free-text value is not. Don't point aidebugger at a process and assume the buffer is safe to paste.
- **Objects expire.** `inspect` reaches the last `AIDEBUGGER_RECENT_OBJECTS` (default 256) captured
  objects; older ones say so rather than lying. Raising it pins that many live objects in memory.

## Conditional traps

The "only capture on call #400" feature — a predicate over the function's locals:

```bash
aidebugger trap myapp.pricing.evaluate_promo --when "base_amount < coupon.min_spend"
```

A predicate that raises 5 times disarms itself rather than spinning in the hot path.

## MCP

```bash
pip install "aidebugger[mcp]" && aidebugger-mcp
```

Same core as the CLI: `trap`, `poll`, `inspect`, `traps`, `untrap`, `probe`.

## Getting in

1. `aidebugger run -- python agent.py` — wrapper, no target changes
2. `PYTHONPATH=.../aidebugger/_shim` — for containers you don't launch yourself
3. `import aidebugger; aidebugger.serve()` — when you own the entrypoint

## Limits

- **Python 3.12+.** No `sys.monitoring` below that.
- **No attach to an already-running PID.** Entry is at process start. The main thing to fix next.
- **One process, one port.** Distributed workers each need their own.

## Tests

```bash
python tests/test_aidebugger.py     # or: pytest tests/
```

MIT.
