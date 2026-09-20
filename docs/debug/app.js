const $ = id => document.getElementById(id);
const MAX_BYTES = 40000;
const api = new URL(window.AIDEBUGGER_CONFIG?.apiBase || '../api/', location.href);
if (!api.pathname.endsWith('/')) api.pathname += '/';
let filename = 'untitled.py', busy = false, connected = false, fixedCode = '';
let operation = null, cancelRun = null, assetsPromise;
const example = `def average(numbers):
    return sum(numbers) / len(numbers)

print("Average:", average([10, 20, 30]))
print("Empty list:", average([]))
`;

function message(text, status = '', style = '') {
  $('message').textContent = text;
  if (status) $('status').textContent = status;
  $('status').className = 'status ' + style;
}
function controls() {
  const hasCode = Boolean($('source').value.trim());
  $('run').disabled = busy || !hasCode;
  $('debug').disabled = busy || !hasCode || !connected;
  for (const id of ['file', 'source', 'goal', 'stdin', 'checks', 'example', 'use-fix', 'download']) $(id).disabled = busy;
  $('stop').hidden = !busy;
}
function resetResults() {
  $('runs').replaceChildren(); $('repair').hidden = true;
  $('results').hidden = true; $('empty').hidden = false;
  fixedCode = '';
  progress(-1);
}
function progress(step) {
  [...$('progress').children].forEach((node, index) => node.classList.toggle('active', index <= step));
}
async function connection() {
  $('reconnect').disabled = true;
  try {
    const response = await fetch(new URL('health', api), {signal: AbortSignal.timeout(8000)});
    const data = response.ok ? await response.json() : {};
    connected = data.ready === true;
    $('connection').textContent = connected ? 'AI connected · ' + data.model : 'AI repairs aren’t connected yet. Run code is available.';
  } catch {
    connected = false;
    $('connection').textContent = 'AI repairs aren’t connected yet. Run code is available.';
  }
  $('connection-dot').classList.toggle('connected', connected);
  $('reconnect').hidden = connected;
  $('reconnect').disabled = false;
  controls();
}
async function textAsset(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load the Python runner. Reload the page and try again.');
  return response.text();
}
async function assets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const names = ['__init__.py', 'engine.py', 'render.py'];
      const [worker, runner, ...sources] = await Promise.all([
        textAsset('worker.js'), textAsset('runner.py'),
        ...names.map(name => textAsset('../live/pkg/aidebugger/' + name))]);
      return {worker, runner, packages: Object.fromEntries(names.map((name, i) => [name, sources[i]]))};
    })().catch(error => { assetsPromise = null; throw error; });
  }
  return assetsPromise;
}

async function runPython(source, snapshot, signal) {
  const payload = await assets();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.title = 'Isolated Python runtime'; frame.hidden = true;
    let timer, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      frame.contentWindow?.postMessage({type: 'stop'}, '*');
      frame.remove();
      cancelRun = null;
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new DOMException('Stopped', 'AbortError'));
    const receive = event => {
      if (event.source !== frame.contentWindow || settled) return;
      const data = event.data;
      if (data?.type === 'sandbox-ready') {
        frame.contentWindow.postMessage({...payload, ...snapshot, source, type: 'run'}, '*');
      } else if (data?.type === 'running') {
        clearTimeout(timer);
        timer = setTimeout(() => finish(null, {ok: false, error: 'Execution stopped after 5 seconds. Check for an infinite loop or a task that takes too long.', stdout: '', stderr: '', events: [], timedOut: true}), 5000);
      } else if (data?.type === 'result') {
        finish(null, data.result);
      } else if (data?.type === 'error') {
        finish(new Error(data.message));
      }
    };
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, {once: true});
    cancelRun = abort;
    timer = setTimeout(() => finish(new Error('Python took too long to load. Check your internet connection and try again.')), 90000);
    frame.src = 'sandbox.html';
    document.body.append(frame);
  });
}

function showRun(result, title) {
  $('empty').hidden = true; $('results').hidden = false;
  const section = document.createElement('section'); section.className = 'run-result';
  const heading = document.createElement('div'); heading.className = 'result-heading';
  const h3 = document.createElement('h3'); h3.textContent = title;
  const badge = document.createElement('span'); badge.className = 'badge' + (result.ok ? ' ok' : '');
  badge.textContent = result.ok ? (result.checksPassed ? 'Checks passed' : 'Completed') : 'Failed';
  heading.append(h3, badge); section.append(heading);
  const output = document.createElement('pre');
  output.textContent = (result.stdout || '') + (result.stderr || '') || '(No printed output)';
  if (result.outputTruncated) output.textContent += '\n[Output truncated]';
  section.append(output);
  if (result.error) {
    const error = document.createElement('pre'); error.className = 'error'; error.textContent = result.error;
    section.append(error);
  }
  if (result.events?.length) {
    const details = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = `${result.events.length} captured runtime events${result.dropped ? ` · ${result.dropped} older events dropped` : ''}`;
    const trace = document.createElement('pre'); trace.textContent = JSON.stringify(result.events, null, 2);
    details.append(summary, trace); section.append(details);
  }
  $('runs').append(section);
}
async function repair(source, result, snapshot, signal) {
  const response = await fetch(new URL('repair', api), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    signal: AbortSignal.any([signal, AbortSignal.timeout(75000)]),
    body: JSON.stringify({source, ...snapshot, evidence: JSON.stringify({
      ok: result.ok, error: result.error, stdout: result.stdout, stderr: result.stderr,
      events: result.events?.slice(-12), dropped: result.dropped
    }).slice(0, 50000)})
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The repair service returned an invalid response. Try again.'); }
  if (!response.ok) throw new Error(data.error || 'The repair service is unavailable. Try again.');
  if (typeof data.code !== 'string' || typeof data.explanation !== 'string' || new TextEncoder().encode(data.code).length > MAX_BYTES) throw new Error('The AI returned an invalid or oversized repair. Try a smaller script.');
  return data;
}
async function start(withAI) {
  if (busy || !$('source').value.trim()) return;
  const original = $('source').value;
  if (new TextEncoder().encode(original).length > MAX_BYTES) {
    message('This version accepts Python scripts up to 40 KB. Use a smaller file.', 'File too large', 'error'); return;
  }
  const snapshot = {filename, stdin: $('stdin').value, checks: $('checks').value, goal: $('goal').value};
  resetResults(); busy = true; operation = new AbortController(); controls(); progress(0);
  const signal = operation.signal;
  try {
    message('Starting Python in your browser and running the original code. The first load can take a moment.', 'Running original');
    let result = await runPython(original, snapshot, signal);
    signal.throwIfAborted();
    showRun(result, 'Original run');
    if (!withAI) {
      message(result.ok ? (result.checksPassed ? 'Your script completed and your checks passed.' : 'Your script completed. Add checks to verify the output is correct.') : 'The original run failed. Read the error above or use Debug & run for an AI repair.', result.ok ? 'Run completed' : 'Error captured', result.ok ? 'ok' : 'error');
      return;
    }
    if (result.ok && (!snapshot.goal.trim() || result.checksPassed)) {
      message(result.checksPassed ? 'Your script completed and your checks already pass. No repair was requested.' : 'No runtime error was found. Describe the incorrect behavior or add a failing check to guide a repair.', 'Run completed', 'ok');
      return;
    }
    let source = original;
    for (let attempt = 1; attempt <= 3; attempt++) {
      progress(1);
      message(`AI is reading the code and runtime evidence. Repair attempt ${attempt} of 3.`, 'Diagnosing');
      const proposal = await repair(source, result, snapshot, signal);
      signal.throwIfAborted();
      if (!proposal.code.trim()) {
        message(proposal.explanation, 'More context needed', 'error'); return;
      }
      fixedCode = proposal.code;
      $('repair').hidden = false; $('fixed-code').textContent = fixedCode;
      $('explanation').textContent = proposal.explanation;
      progress(2);
      message(`Running repair ${attempt} in a fresh Python runtime${snapshot.checks.trim() ? ' with your unchanged checks' : ''}.`, 'Verifying repair');
      result = await runPython(fixedCode, snapshot, signal);
      signal.throwIfAborted();
      showRun(result, `Repair ${attempt}`);
      if (result.ok) {
        message(result.checksPassed ? 'The repaired script ran and your checks passed. Review the change and download the file.' : 'The repaired script ran without an error. Review its output; add checks to verify the intended behavior.', result.checksPassed ? 'Checks passed' : 'Repair ran', 'ok');
        return;
      }
      source = fixedCode;
    }
    message('The code still fails after 3 repair attempts. The latest error and proposed code are shown here. Add more detail or checks before trying again.', 'Still failing', 'error');
  } catch (error) {
    if (error.name === 'AbortError') message('Stopped. Your original code is unchanged.', 'Stopped');
    else message(error.name === 'TimeoutError' ? 'The AI repair timed out. You can retry or run the code yourself.' : error.message, 'Could not finish', 'error');
  } finally {
    busy = false; operation = null; controls();
  }
}

async function loadFile(file) {
  if (!file || busy) return;
  if (!/\.py$/i.test(file.name)) { message('Choose a single Python (.py) file. ZIPs and other languages are not supported yet.', 'Unsupported file', 'error'); return; }
  if (file.size > MAX_BYTES) { message('Choose a Python file smaller than 40 KB.', 'File too large', 'error'); return; }
  try {
    const content = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
    if (content.includes('\0')) throw new Error('Binary content');
    if (!content.trim()) { message('This file is empty. Choose a Python file with code.', 'Empty file', 'error'); return; }
    filename = file.name.slice(0, 120); $('filename').textContent = filename;
    $('source').value = content; $('goal').value = ''; $('checks').value = ''; $('stdin').value = '';
    resetResults(); controls(); message(`${filename} is ready. Run it to capture the error${connected ? ', or choose Debug & run for an automatic repair' : ''}.`, 'File loaded');
  } catch { message('Could not read this file as UTF-8 Python text.', 'Invalid file', 'error'); }
}
$('file').addEventListener('change', event => { loadFile(event.target.files[0]); event.target.value = ''; });
$('dropzone').addEventListener('dragover', event => { event.preventDefault(); if (!busy) $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
$('dropzone').addEventListener('drop', event => {
  event.preventDefault(); $('dropzone').classList.remove('dragging');
  if (event.dataTransfer.files.length !== 1) { message('Choose one Python file at a time.', 'One file required', 'error'); return; }
  loadFile(event.dataTransfer.files[0]);
});
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
$('example').onclick = () => {
  filename = 'average.py'; $('filename').textContent = filename; $('source').value = example;
  $('goal').value = 'Return the average of a list of numbers. An empty list should return 0.';
  $('checks').value = 'assert average([10, 20, 30]) == 20\nassert average([]) == 0\nassert average([-2, 2]) == 0';
  $('stdin').value = ''; resetResults(); controls(); message('Example loaded. The empty list causes a division-by-zero error.', 'Example loaded');
};
for (const id of ['source', 'goal', 'checks', 'stdin']) $(id).addEventListener('input', () => {
  resetResults(); message('Ready to run your updated code.', 'Ready'); controls();
});
$('source').addEventListener('keydown', event => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault(); const input = event.target;
    input.setRangeText('    ', input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input'));
  }
});
$('run').onclick = () => start(false);
$('debug').onclick = () => start(true);
$('stop').onclick = () => { operation?.abort(); cancelRun?.(); };
$('reconnect').onclick = connection;
$('download').onclick = () => {
  if (!fixedCode) return;
  const url = URL.createObjectURL(new Blob([fixedCode], {type: 'text/x-python;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = filename.replace(/\.py$/i, '') + '.fixed.py';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('use-fix').onclick = () => {
  $('source').value = fixedCode; resetResults(); controls();
  message('Repaired code is in the editor. Run it again or add more checks.', 'Ready'); $('source').focus();
};
connection();
