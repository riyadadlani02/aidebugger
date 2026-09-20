"""Real runner + HTTP boundary tests. Model responses are explicitly mocked here."""
import importlib.util
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from aidebugger.web import Budget, make_handler, request_repair, validate_request

spec = importlib.util.spec_from_file_location("browser_runner", ROOT / "docs/debug/runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def run_code(self, source, **kwargs):
        return json.loads(runner.run_upload(source, "upload.py", **kwargs))

    def test_actual_error_and_runtime_arguments(self):
        result = self.run_code("def average(xs):\n    return sum(xs)/len(xs)\naverage([])")
        self.assertFalse(result["ok"])
        self.assertIn("ZeroDivisionError", result["error"])
        call = next(e for e in result["events"] if e["symbol"] == "average")
        self.assertEqual(call["locals"]["xs"]["value"], [])

    def test_fixed_source_and_independent_checks(self):
        result = self.run_code("def average(xs):\n    return sum(xs)/len(xs) if xs else 0",
                               checks="assert average([]) == 0\nassert average([2,4]) == 3")
        self.assertTrue(result["ok"])
        self.assertTrue(result["checksPassed"])

    def test_failed_check_does_not_claim_success(self):
        result = self.run_code("def answer(): return 42", checks="assert answer() == 43")
        self.assertFalse(result["ok"])
        self.assertFalse(result["checksPassed"])
        self.assertIn("user_checks.py", result["error"])

    def test_stdin_main_and_output(self):
        result = self.run_code("if __name__ == '__main__':\n    print(input())", stdin="hello\n")
        self.assertTrue(result["ok"])
        self.assertEqual(result["stdout"], "hello\n")

    def test_main_module_supports_dataclasses(self):
        result = self.run_code("from dataclasses import dataclass\n@dataclass\nclass Item:\n    n: int\nprint(Item(2).n)")
        self.assertTrue(result["ok"], result["error"])
        self.assertEqual(result["stdout"], "2\n")

    def test_syntax_error_and_exit_status(self):
        self.assertIn("SyntaxError", self.run_code("if True\n pass")["error"])
        self.assertTrue(self.run_code("raise SystemExit(0)")["ok"])
        self.assertFalse(self.run_code("raise SystemExit(1)")["ok"])
        self.assertFalse(self.run_code("raise SystemExit(0)", checks="assert False")["ok"])

    def test_bounded_output_and_trace(self):
        result = self.run_code("def f(): pass\nfor i in range(200): f()\nprint('x'*50000)")
        self.assertLessEqual(len(result["stdout"]), 16000)
        self.assertTrue(result["outputTruncated"])
        self.assertEqual(len(result["events"]), 60)
        self.assertGreater(result["dropped"], 0)


class APITests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(
            ROOT / "docs", api_key="test-only", origins=("https://example.com",), daily_limit=2))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, body=None, origin="https://example.com", path="/api/repair"):
        req = urllib.request.Request(self.url + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", "Origin": origin})
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, json.load(res), res.headers
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc), exc.headers

    def test_health_and_origin(self):
        status, result, _ = self.request(path="/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(result["ready"])
        status, _, headers = self.request({"source": "print(1)"}, origin="null")
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_input_limits(self):
        for body in [{"source": ""}, {"source": 3}, {"source": "x"*40001}, []]:
            self.assertEqual(self.request(body)[0], 400)
        self.assertEqual(self.request({"source": "x" * 130000})[0], 413)

    def test_repair_never_executes_code_and_budget_is_enforced(self):
        code = "raise RuntimeError('must not execute on server')"
        with patch("aidebugger.web.request_repair", return_value={"code": code, "explanation": "fixture"}) as model:
            status, result, headers = self.request({"source": code, "checks": "assert False"})
            self.assertEqual(status, 200)
            self.assertEqual(result["code"], code)
            self.assertEqual(model.call_args.args[0]["checks"], "assert False")
            self.assertEqual(headers["Access-Control-Allow-Origin"], "https://example.com")
            self.assertEqual(self.request({"source": code})[0], 200)
            self.assertEqual(self.request({"source": code})[0], 429)
            self.assertEqual(model.call_count, 2)

    def test_provider_details_are_not_leaked(self):
        with patch("aidebugger.web.request_repair", side_effect=OSError("secret-provider-key")):
            status, result, _ = self.request({"source": "print(1)"})
            self.assertEqual(status, 502)
            self.assertNotIn("secret-provider-key", json.dumps(result))

    def test_no_provider_disables_repair(self):
        other = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(ROOT / "docs"))
        thread = threading.Thread(target=other.serve_forever, daemon=True)
        thread.start()
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{other.server_port}/api/repair", data=b'{}')
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(req, timeout=5)
            self.assertEqual(error.exception.code, 503)
        finally:
            other.shutdown(); other.server_close(); thread.join()

    def test_api_only_mode_does_not_expose_static_files(self):
        other = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(ROOT / "docs", api_only=True))
        thread = threading.Thread(target=other.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{other.server_port}"
            self.assertFalse(json.load(urllib.request.urlopen(base + "/api/health"))["ready"])
            for path in ("/", "/debug/config.js", "/WEB_DEPLOYMENT.md"):
                for method in ("GET", "HEAD"):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(urllib.request.Request(base + path, method=method), timeout=5)
                    self.assertEqual(error.exception.code, 404)
        finally:
            other.shutdown(); other.server_close(); thread.join()


class ProviderTests(unittest.TestCase):
    def test_actual_http_contract_and_invalid_model_output(self):
        seen = []
        reply = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(
            {"code": "print(42)", "explanation": "Corrected the value."})}}]}

        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                seen.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps(reply).encode())

        server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            options = dict(api_key="fixture", base_url=f"http://127.0.0.1:{server.server_port}/v1", model="fixture")
            result = request_repair({"source": "print(41)", "checks": "assert True"}, **options)
            self.assertEqual(result["code"], "print(42)")
            self.assertEqual(seen[0][0], "/v1/chat/completions")
            self.assertEqual(json.loads(seen[0][1]["messages"][1]["content"])["checks"], "assert True")
            reply["choices"][0]["finish_reason"] = "length"
            with self.assertRaises(ValueError): request_repair({"source": "print(1)"}, **options)
            reply["choices"][0]["finish_reason"] = "stop"
            reply["choices"][0]["message"]["content"] = '{"code":42,"explanation":"bad"}'
            with self.assertRaises(ValueError): request_repair({"source": "print(1)"}, **options)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
