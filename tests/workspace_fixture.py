"""Browser-test-only model fixture. Never used by the application or Docker image."""
import json
from pathlib import Path
import sys
from http.server import ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from aidebugger.web import make_handler

state = {"ready": False, "mode": "retry", "calls": 0, "checks": []}
GOOD_CODE = "def average(numbers):\n    return sum(numbers) / len(numbers) if numbers else 0\nprint(average([]))\n"


def fixture_repair(body, **_):
    state["calls"] += 1
    state["checks"].append(body["checks"])
    if state["mode"] == "error":
        raise ValueError("Fixture provider failure")
    broken = state["mode"] == "fail" or (state["mode"] == "retry" and state["calls"] == 1)
    return {"code": 'raise ValueError("fixture still broken")' if broken else GOOD_CODE,
            "explanation": '<script>throw Error("XSS")</script> Fixture explanation.'}


class Handler(make_handler(ROOT / "docs", api_key="test-only-fixture")):
    def do_GET(self):
        if self.path == "/api/health":
            return self.send_json({"ready": state["ready"], "model": "test fixture"})
        if self.path == "/__test/state":
            return self.send_json(state)
        return super().do_GET()

    def do_POST(self):
        if self.path == "/__test/control":
            state.update(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            return self.send_json(state)
        return super().do_POST()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    print(f"http://127.0.0.1:{server.server_port}/debug/", flush=True)
    with patch("aidebugger.web.request_repair", fixture_repair):
        server.serve_forever()
