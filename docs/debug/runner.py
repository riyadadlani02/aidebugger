"""Browser runner. Untrusted programs must only run in the isolated browser worker."""
import contextlib
import io
import json
import sys
import traceback
import types

from aidebugger.engine import Buffer, Engine


class LimitedOutput(io.StringIO):
    def __init__(self):
        super().__init__()
        self.remaining = 16000
        self.truncated = False

    def write(self, text):
        length = len(text)
        super().write(text[:self.remaining])
        self.remaining = max(0, self.remaining - length)
        self.truncated |= length > 0 and self.remaining == 0
        return length


def run_upload(source, filename, stdin="", checks=""):
    output, errors = LimitedOutput(), LimitedOutput()
    engine = Engine(Buffer(60))
    result = {"ok": False, "error": "", "checksPassed": False}
    original_stdin, original_argv = sys.stdin, sys.argv
    original_main = sys.modules.get("__main__")
    module = types.ModuleType("__main__")
    module.__file__ = filename
    sys.modules["__main__"] = module
    namespace = module.__dict__

    def arm(code):
        # RAISE is a global-only monitoring event; traceback captures failures here.
        engine.arm_code(code, code.co_qualname, events=("call", "return"))
        for constant in code.co_consts:
            if isinstance(constant, types.CodeType):
                arm(constant)

    try:
        sys.stdin, sys.argv = io.StringIO(stdin), [filename]
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = compile(source, filename, "exec")
            arm(code)
            try:
                exec(code, namespace)
            except SystemExit as exc:
                if exc.code not in (None, 0):
                    raise
            if checks.strip():
                exec(compile(checks, "user_checks.py", "exec"), namespace)
                result["checksPassed"] = True
            result["ok"] = True
    except BaseException as exc:
        result["error"] = "".join(traceback.format_exception(exc, limit=8))[-8000:]
    finally:
        sys.stdin, sys.argv = original_stdin, original_argv
        if original_main is not None:
            sys.modules["__main__"] = original_main
        else:
            sys.modules.pop("__main__", None)
        engine.close()
    result.update(stdout=output.getvalue(), stderr=errors.getvalue(),
                  outputTruncated=output.truncated or errors.truncated,
                  events=engine.buffer.poll(0, 60)["events"], dropped=engine.buffer.dropped)
    return json.dumps(result)
