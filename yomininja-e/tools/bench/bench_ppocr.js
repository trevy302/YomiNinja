// Benchmarks the PaddleOCR engine (ppocr_infer_service_grpc) over gRPC, the same way YomiNinja drives it.
//
// For each configuration it starts the engine, applies the settings with UpdatePpOcrSettings (which the engine
// persists to its preset file), restarts the engine so runtime/thread changes take effect (like the app does),
// then measures: startup time, the first (cold) request, and N warm requests. Accuracy is scored against the
// ground-truth JSON written by make_bench_image.py.
//
// Usage (from yomininja-e/):
//   node tools/bench/bench_ppocr.js --images <dir with bench_*.png/json> [--exe <ppocr exe>] [--runs 10]
//        [--warmup 2] [--port 52100] [--matrix quick|full] [--jpeg-quality 100] [--load 0] [--out results.json]
//
// --exe defaults to the packaged engine in dist/win-unpacked. Images are sent as JPEG, matching what the
// screen capturer produces. --load N keeps N background threads busy during the measurements, to simulate a
// game competing for the CPU.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const sharp = require('sharp');

const args = parseArgs(process.argv.slice(2));
const ROOT = path.join(__dirname, '../..');
const EXE = path.resolve(args.exe || path.join(ROOT, 'dist/win-unpacked/resources/bin/ppocr/ppocr_infer_service_grpc.exe'));
const IMAGES_DIR = path.resolve(args.images || '.');
const RUNS = Number(args.runs || 10);
const WARMUP = Number(args.warmup || 2);
const PORT = Number(args.port || 52100);
const JPEG_QUALITY = Number(args['jpeg-quality'] || 100);
const LOAD_THREADS = Number(args.load || 0);
const LANGUAGE = 'ja-JP';

// Simulated background load: each worker spins in short bursts with brief sleeps, roughly like a game's
// render/simulation threads (busy most of the time, yielding every frame).
function startLoad(n) {
    const { Worker } = require('worker_threads');
    const code = `
        const sab = new Int32Array(new SharedArrayBuffer(4));
        for (;;) {
            const end = performance.now() + 14;   // ~14 ms of work per 16.7 ms frame
            let x = 0; while (performance.now() < end) x += Math.sqrt(x + 1);
            Atomics.wait(sab, 0, 0, 2);
        }`;
    return Array.from({ length: n }, () => new Worker(code, { eval: true }));
}

const BASE_SETTINGS = {
    max_image_width: 1600,
    cpu_threads: os.cpus().length,
    inference_runtime: 'ONNX_CPU',
    det_db_thresh: 0.3,
    det_db_box_thresh: 0.6,
    det_db_unclip_ratio: 1.6,
    det_db_score_mode: 'slow',
    use_dilation: false,
    cls_thresh: 0.9,
};

function matrix(kind) {
    const configs = [];
    const add = (overrides) => configs.push({ ...BASE_SETTINGS, ...overrides });
    if (kind === 'full') {
        for (const inference_runtime of ['ONNX_CPU', 'Open_VINO'])
            for (const cpu_threads of [4, 8, 12, 16, 24, 32])
                add({ inference_runtime, cpu_threads });
        return configs;
    }
    if (kind === 'quick') {
        add({}); // current defaults (baseline)
        add({ inference_runtime: 'Open_VINO' });
        add({ cpu_threads: 8 });
        add({ inference_runtime: 'Open_VINO', cpu_threads: 8 });
        return configs;
    }
    // Comma-separated "key=value;key=value" sets, e.g. --matrix "inference_runtime=Open_VINO;cpu_threads=8,cpu_threads=4"
    for (const set of kind.split(',')) {
        const o = {};
        for (const kv of set.split(';').filter(Boolean)) {
            const [k, v] = kv.split('=');
            o[k] = isNaN(Number(v)) ? (v === 'true' ? true : v === 'false' ? false : v) : Number(v);
        }
        add(o);
    }
    return configs;
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? 'true' : argv[++i];
    }
    return out;
}

// ---------- engine process ----------

const proto = grpc.loadPackageDefinition(
    protoLoader.loadSync(path.join(ROOT, '../ocr_services/protos/ocr_service.proto'), { keepCase: true })
).ocr_service;

function startEngine(presetsRoot) {
    return new Promise((resolve, reject) => {
        const t0 = performance.now();
        const child = spawn(EXE, [presetsRoot + path.sep, 'default', String(PORT)], { cwd: path.dirname(EXE) });
        let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; child.kill(); reject(new Error('engine start timeout')); } }, 60000);
        child.stdout.on('data', (d) => {
            const s = d.toString();
            if (!settled && s.includes('[INFO-JSON]:')) {
                settled = true;
                clearTimeout(timer);
                const client = new proto.OCRService(`127.0.0.1:${PORT}`, grpc.credentials.createInsecure(), {
                    'grpc.max_receive_message_length': 64 * 1024 * 1024,
                    'grpc.max_send_message_length': 64 * 1024 * 1024,
                });
                resolve({ child, client, startupMs: performance.now() - t0 });
            }
        });
        child.on('exit', (code) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('engine exited ' + code)); } });
    });
}

function stopEngine(engine) {
    return new Promise((resolve) => {
        if (!engine) return resolve();
        engine.client.close();
        engine.child.once('exit', () => resolve());
        engine.child.kill();
        setTimeout(resolve, 3000);
    });
}

function call(client, method, req) {
    return new Promise((resolve, reject) => {
        client[method](req, { deadline: Date.now() + 120000 }, (err, res) => (err ? reject(err) : resolve(res)));
    });
}

// ---------- accuracy ----------

// Edit distance of `needle` against the best-matching substring of `hay` (semi-global alignment).
function substringDistance(needle, hay) {
    const n = needle.length, m = hay.length;
    let prev = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
        const cur = new Array(m + 1);
        cur[0] = i;
        for (let j = 1; j <= m; j++) {
            const cost = needle[i - 1] === hay[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return Math.min(...prev);
}

const normalize = (s) => s.normalize('NFKC').replace(/\s+/g, '');

function responseText(res) {
    const lines = [];
    for (const r of res.results || []) for (const tl of r.text_lines || []) {
        const b = tl.box || r.box;
        const ys = b ? [b.top_left, b.top_right, b.bottom_left, b.bottom_right].map((v) => v?.y || 0) : [0];
        const xs = b ? [b.top_left, b.top_right, b.bottom_left, b.bottom_right].map((v) => v?.x || 0) : [0];
        lines.push({ text: tl.content, y: (Math.min(...ys) + Math.max(...ys)) / 2, h: Math.max(...ys) - Math.min(...ys), x: Math.min(...xs) });
    }
    lines.sort((a, b) => (Math.abs(a.y - b.y) < Math.max(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y));
    return lines.map((l) => l.text).join('\n');
}

function score(res, truth) {
    const hay = normalize(responseText(res));
    let errors = 0, chars = 0;
    for (const line of truth) {
        const t = normalize(line);
        errors += substringDistance(t, hay);
        chars += t.length;
    }
    return { cer: errors / chars, errors, chars };
}

// ---------- main ----------

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const median = (arr) => pct(arr, 0.5);
const label = (c) => `${c.inference_runtime.padEnd(9)} thr=${String(c.cpu_threads).padStart(2)} score=${c.det_db_score_mode.padEnd(4)} maxw=${c.max_image_width}`;

(async () => {
    const images = fs.readdirSync(IMAGES_DIR).filter((f) => /^bench_\d+x\d+\.png$/.test(f) || f === 'real.png');
    if (!images.length) throw new Error('no bench_*.png images in ' + IMAGES_DIR);
    const inputs = [];
    for (const f of images) {
        const jpeg = await sharp(path.join(IMAGES_DIR, f)).jpeg({ quality: JPEG_QUALITY }).toBuffer();
        const truthFile = path.join(IMAGES_DIR, f.replace(/\.png$/, '.json'));
        const truth = fs.existsSync(truthFile) ? JSON.parse(fs.readFileSync(truthFile, 'utf-8')).lines : null;
        inputs.push({ name: f, jpeg, truth });
    }

    const presetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ppocr-bench-'));
    fs.copyFileSync(path.join(path.dirname(EXE), 'presets/default.json'), path.join(presetsRoot, 'default.json'));

    console.log(`engine: ${EXE}\nimages: ${inputs.map((i) => `${i.name} (${(i.jpeg.length / 1024).toFixed(0)} KB jpeg q${JPEG_QUALITY})`).join(', ')}\nruns: ${WARMUP} warm-up + ${RUNS} timed, background load: ${LOAD_THREADS} threads\n`);
    const results = [];
    const loadWorkers = startLoad(LOAD_THREADS);

    for (const config of matrix(args.matrix || 'quick')) {
        let engine;
        try {
            // Apply settings, then restart so runtime/thread changes take effect.
            engine = await startEngine(presetsRoot);
            await call(engine.client, 'UpdatePpOcrSettings', config);
            await stopEngine(engine);
            engine = await startEngine(presetsRoot);
            const saved = JSON.parse(fs.readFileSync(path.join(presetsRoot, 'default.json'), 'utf-8'));

            if (args.prewarm) {
                // Simulates a warm-up request sent right after the engine starts (blank image, no text).
                const size = Number(args.prewarm) || 64;
                const blank = await sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
                const t = performance.now();
                await call(engine.client, 'RecognizeBytes', { id: 'warmup', language_code: args['prewarm-lang'] ?? LANGUAGE, image_bytes: blank });
                console.log(`  prewarm (${size}x${size} blank) took ${(performance.now() - t).toFixed(0)}ms`);
            }

            for (const input of inputs) {
                const req = { id: 'bench', language_code: LANGUAGE, image_bytes: input.jpeg };
                let t = performance.now();
                const first = await call(engine.client, 'RecognizeBytes', req);
                const coldMs = performance.now() - t;
                for (let i = 1; i < WARMUP; i++) await call(engine.client, 'RecognizeBytes', req);
                const times = [];
                let last = first;
                for (let i = 0; i < RUNS; i++) {
                    t = performance.now();
                    last = await call(engine.client, 'RecognizeBytes', req);
                    times.push(performance.now() - t);
                }
                const acc = input.truth ? score(last, input.truth) : null;
                const row = {
                    config, image: input.name, savedBackend: saved.inference_backend, savedThreads: saved.cpu_threads,
                    startupMs: engine.startupMs, coldMs, medianMs: median(times), p90Ms: pct(times, 0.9),
                    cer: acc?.cer ?? null, text: responseText(last),
                };
                results.push(row);
                console.log(`${label(config)} | ${input.name.padEnd(19)} | start ${(row.startupMs / 1000).toFixed(1)}s cold ${row.coldMs.toFixed(0).padStart(6)}ms | median ${row.medianMs.toFixed(0).padStart(5)}ms p90 ${row.p90Ms.toFixed(0).padStart(5)}ms | CER ${acc ? (acc.cer * 100).toFixed(1) + '%' : 'n/a'} | saved=${saved.inference_backend}/${saved.cpu_threads}`);
            }
        } catch (e) {
            console.log(`${label(config)} | FAILED: ${e.message}`);
            results.push({ config, error: e.message });
        } finally {
            await stopEngine(engine);
        }
    }

    await Promise.all(loadWorkers.map((w) => w.terminate()));
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(results.map((r) => ({ ...r, loadThreads: LOAD_THREADS })), null, 2));
    fs.rmSync(presetsRoot, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
