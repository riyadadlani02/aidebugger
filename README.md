# aidebugger

**[Run it live in your browser →](https://riyadadlani02.github.io/aidebugger/live/)** ·
**[Site →](https://riyadadlani02.github.io/aidebugger/)** ·
**[Demo video →](https://riyadadlani02.github.io/aidebugger/#video)**

Non-stopping runtime traps for live AI agent processes — so an AI coding agent can read **real
values** out of a running agent without freezing the agent it's debugging.

```bash
aidebugger run -- python my_agent.py          # zero code changes to the target
aidebugger trap --trapset livekit             # or: aidebugger trap pkg.mod.Class.method
aidebugger poll 0                             # JSON events, non-blocking
aidebugger inspect 160                        # expand an object one level
```

## Install

Python 3.12 or newer — the whole design rests on `sys.monitoring`, which does not exist before
that. No dependencies outside the standard library.

```bash
pip install git+https://github.com/riyadadlani02/aidebugger
uv pip install git+https://github.com/riyadadlani02/aidebugger          # or with uv
pip install "aidebugger[mcp] @ git+https://github.com/riyadadlani02/aidebugger"   # with the MCP server
```

Not on PyPI yet. `.github/workflows/publish.yml` publishes on a `v*` tag once the name is claimed
there — PyPI trusted publishing, so there is no token to store.

**Or install nothing:** [run it live in your browser](https://riyadadlani02.github.io/aidebugger/live/).
Pyodide is CPython 3.13 compiled to WebAssembly and `sys.monitoring` came with it, so the engine
runs unmodified in a tab — real traps, real captured values, no server anywhere.

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

## Upload, debug, and run your own code

The [debugging workspace](https://riyadadlani02.github.io/aidebugger/debug/) accepts a real `.py`
upload or pasted Python source. It runs the original script, captures errors and aidebugger
events, requests a model-generated repair, and reruns that repair in a fresh runtime.
It makes at most three repair attempts and never labels a failed run as fixed. User-supplied
checks remain unchanged across attempts. A successful run means execution completed;
without checks it does not establish that the program is semantically correct.

Run the workspace and API from this checkout with Python 3.12+:

```bash
export AIDEBUGGER_AI_API_KEY='your-provider-key'
python -m aidebugger.web
# open http://127.0.0.1:8787/debug/
```

Without a key, uploads and **Run code** still work, and the UI reports that AI repairs are
not connected. No fallback fixes or simulated model responses are used in the application.
See [web deployment instructions](docs/WEB_DEPLOYMENT.md) to connect the GitHub Pages
frontend to a hosted API or use a local OpenAI-compatible model.

Scope: one UTF-8 Python file up to 40 KB, the standard library, optional stdin and checks.
Each execution gets a new Pyodide 0.28.3 worker in an opaque-origin sandboxed iframe.
It has no access to the parent page's storage, model key, or filesystem. A 5-second
execution deadline and Stop button dispose of the runtime; initial runtime loading has
a separate 90-second deadline. Network requests are restricted by the sandbox CSP to
the pinned Pyodide CDN path. This is a browser execution environment, not a hostile-code
multi-tenant server sandbox; resource-heavy code can still strain the visitor's browser.
Extra packages, project archives, network services, and persistent servers are not supported.

Only **Debug & run** sends source, stdin, checks, goals, and bounded runtime evidence to
the configured model through the API. Keys remain server-side. Uploaded code is never
executed by the API. Trace locals use aidebugger's key-based redaction; source and printed
output are sent as entered, so do not include secrets in code submitted for AI repair.

## Live console

[Try it without installing anything](https://riyadadlani02.github.io/aidebugger/live/) — the real
console, wired to a real aidebugger engine running in your browser. Arm a trap on the checkout
pricing code, apply the coupon, and read the values that come back; tick *apply the fix* and
the same trap re-reads the repaired run. Nothing is recorded and nothing is served: it is
CPython 3.13 on WebAssembly, arming `sys.monitoring` traps in your tab.


The trap server serves a console at its own port — open it while the target runs:

```bash
open "http://127.0.0.1:$(cat ${TMPDIR:-/tmp}/aidebugger.port)/"
```

A time axis that keeps advancing whether or not events arrive (the target is running the whole
time), the armed traps with hit counts, and the event stream. Click an event for its locals; click
a non-primitive to expand it from the live process.

## Demos

| | |
|---|---|
| [Checkout](https://riyadadlani02.github.io/aidebugger/demo-phone/) | A coupon silently rejected because two functions disagree about the subtotal. Before/after the fix. |
| [Voice agent](https://riyadadlani02.github.io/aidebugger/demo-voice/) | A LiveKit call filed against the wrong person because a matcher defaulted to `self`. Before/after the fix. |
| [Console](https://riyadadlani02.github.io/aidebugger/demo/) | The console replaying ten recorded runs — the three story agents mid-bug ([LangGraph](https://riyadadlani02.github.io/aidebugger/demo/?ds=langgraph_order), [OpenAI Agents](https://riyadadlani02.github.io/aidebugger/demo/?ds=openai_agents_handoff), [Pydantic AI](https://riyadadlani02.github.io/aidebugger/demo/?ds=pydantic_ai_billing)), plus — plain Python, plus every adapter through both doors: LangChain [sync](https://riyadadlani02.github.io/aidebugger/demo/?ds=langchain) / [async](https://riyadadlani02.github.io/aidebugger/demo/?ds=langchain_async), OpenAI Agents [async](https://riyadadlani02.github.io/aidebugger/demo/?ds=openai_agents) / [run_sync](https://riyadadlani02.github.io/aidebugger/demo/?ds=openai_agents_sync), Pydantic AI [async](https://riyadadlani02.github.io/aidebugger/demo/?ds=pydantic_ai) / [run_sync](https://riyadadlani02.github.io/aidebugger/demo/?ds=pydantic_ai_sync). |

Every state in them is a real capture from `examples/`, in both the broken and repaired form.
Each demo agent ships broken on purpose, with one env var that applies the repair, so the before
and after are both recordable from one file:

| example | the bug | repaired by |
|---|---|---|
| `checkout_app/backend.py` | min-spend checked against the post-discount subtotal | `CHECKOUT_FIXED=1` |
| `voice_agent.py` | relationship matcher only accepts a bare word, defaults to `self` | `VOICE_FIXED=1` |
| `langgraph_order_agent.py` | reply node prompts the model without the tool's result | `LANGGRAPH_FIXED=1` |
| `openai_agents_handoff_agent.py` | handoff forwards a summary that drops the customer's £50 cap | `HANDOFF_FIXED=1` |
| `pydantic_ai_billing_agent.py` | pence handed to a tool that takes pounds — £49.99 credited as £4,999 | `BILLING_FIXED=1` |

None of them raise, and every transcript reads like a working agent. The wrong value is only
visible in the frame. Regenerate the framework
recordings (no API keys) with `python scripts/record_timeline.py`.

## Trap sets

Semantic hooks instead of line numbers. Adapters are JSON data, not code.

```bash
aidebugger trap --trapset livekit --hook on-tool-call
aidebugger probe                 # which symbols resolve against what's installed
```

| Adapter | Hooks | Verified against |
|---|---|---|
| `livekit` | on-tool-call, on-llm-request, on-handoff, on-user-turn | livekit-agents 1.6.6, on a live production voice agent — 7/7 |
| `langchain` | on-agent-run, on-llm-request, on-tool-call, on-state-write | langchain-core 1.6.2 + langgraph — 9/9 across sync + async |
| `openai_agents` | on-agent-run, on-turn, on-llm-request, on-tool-call, on-handoff | openai-agents 0.22.0 — 6/6 async, 5/6 through `Runner.run_sync` |
| `pydantic_ai` | on-agent-run, on-llm-request, on-tool-call | pydantic-ai 2.40.0 — 4/4 both ways |

Every symbol above was observed **firing** against a running agent, not merely resolving — a
symbol can resolve and never be called, which is how a trapset rots silently when a framework
moves a function. Sync and async are recorded separately because they are not the same code path:
LangChain's four `a*` symbols never fire in a synchronous graph, and `Runner.run` never fires when
the OpenAI Agents SDK is entered through `run_sync`. Reproduce it yourself, no API keys needed:

```bash
python scripts/verify_trapset.py            # all four, against examples/
```

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
