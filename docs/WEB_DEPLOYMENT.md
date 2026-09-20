# Deploy the upload workspace

GitHub Pages serves static files. The Python runtime runs in the visitor's browser;
AI repairs also need the small `aidebugger.web` service. Do not put a provider key in
`docs/debug/config.js`, source control, a browser form, or a GitHub Pages asset.

## Local use

From a source checkout, with Python 3.12 or newer:

```bash
export AIDEBUGGER_AI_API_KEY='your-provider-key'
python -m aidebugger.web
```

Open `http://127.0.0.1:8787/debug/`. The default provider is OpenAI, using
`gpt-4.1-mini`. Set `AIDEBUGGER_AI_MODEL` for a different JSON-capable model and
`AIDEBUGGER_AI_BASE_URL` for a compatible `/v1` API. The service appends `/chat/completions`.

For a local Ollama instance with a compatible model already installed:

```bash
export AIDEBUGGER_AI_BASE_URL='http://127.0.0.1:11434/v1'
export AIDEBUGGER_AI_MODEL='your-installed-model'
export AIDEBUGGER_AI_API_KEY='ollama'
python -m aidebugger.web
```

## Public use with the existing GitHub Pages site

1. Deploy this checkout's Dockerfile to a container host with HTTPS. Set the API key
   as a secret in the host's settings. Do not include it in the image.
2. Set `AIDEBUGGER_ALLOWED_ORIGINS=https://riyadadlani02.github.io`. If also serving the UI
   from the API host, add its HTTPS origin, comma-separated with no trailing slash.
3. Set a provider-side spending limit. `AIDEBUGGER_DAILY_REPAIRS` defaults to 100 requests
   per rolling 24-hour window per process, with two model requests concurrently.
4. Set `apiBase` in `docs/debug/config.js` to `https://YOUR-API-HOST/api/` and publish
   the updated `docs/` folder through the existing GitHub Pages deployment.
5. Check `/api/health` returns `ready: true`, then upload your own small broken script
   and run **Debug & run**. Verify the original fails, the repair runs, and the
   downloaded file matches the displayed code. Add assertions for expected behavior.

The health endpoint reports configuration presence, not provider authentication.
The UI surfaces provider authentication/quota failures during a repair.

The service uses Python's standard-library HTTP server behind your host's HTTPS proxy.
It is suitable for a small pilot. Before exposing it at scale, add gateway authentication
or bot protection, durable shared rate limiting, and request limits at the proxy. Origin
checking is a browser policy, not authentication. The in-memory request budget resets on
restart and is independent per replica; provider-side budgets are the spending boundary.
Requests can use up to 12,000 output tokens, and one debug session can make three requests.

Do not expose the existing `aidebugger.server` trap control plane as this public API; it is
a separate localhost-only tool for live processes. `aidebugger.web` does not execute uploads.

## Rebuild and verify

```bash
python scripts/build_live.py
python tests/test_aidebugger.py
python -m unittest discover -s tests -p 'test_web.py'
node tests/test_workspace.cjs
```

The browser test uses real Pyodide execution and a clearly marked fixture model response;
it does not prove live model quality. It needs Chrome and the existing `scripts/video`
Puppeteer dependency (`npm install --prefix scripts/video`).
