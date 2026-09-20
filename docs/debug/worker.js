// This file is loaded as text into an opaque-origin, sandboxed iframe.
importScripts('https://cdn.jsdelivr.net/pyodide/v0.28.3/full/pyodide.js');
self.onmessage = async ({data}) => {
  try {
    const py = await loadPyodide({indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/'});
    py.FS.mkdirTree('/home/pyodide/aidebugger');
    for (const [name, source] of Object.entries(data.packages)) {
      py.FS.writeFile('/home/pyodide/aidebugger/' + name, source);
    }
    py.runPython(data.runner);
    self.postMessage({type: 'running'});
    const run = py.globals.get('run_upload');
    const result = JSON.parse(run(data.source, data.filename, data.stdin, data.checks));
    run.destroy();
    self.postMessage({type: 'result', result});
  } catch (error) {
    self.postMessage({type: 'error', message: String(error)});
  }
};
