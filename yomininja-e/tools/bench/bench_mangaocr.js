// Benchmarks the Manga OCR engine of the Python OCR service over gRPC, the same way YomiNinja calls it.
//
// Starts py_ocr_service.py with the given Python (the app passes CUSTOM_MODULES_PATH and MODELS_PATH the same
// way), then measures full recognition (detect + recognize every line) on each image.
// The service loads the Manga OCR models on the first request, so the first image's "first" time includes that.
//
// Usage (from yomininja-e/):
//   node tools/bench/bench_mangaocr.js --images <dir> [--python <python.exe>] [--src <py_ocr_service/src>]
//        [--models <models dir>] [--runs 5] [--port 53900]
//
// Defaults use the build tree (ocr_services/py_ocr_service) and the models YomiNinja downloaded into
// %APPDATA%/YomiNinja/bin/py_ocr_service/models.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const sharp = require('sharp');

const args = {};
process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith('--')) args[a.slice(2)] = all[i + 1]; });

const ROOT = path.join(__dirname, '../..');
const PY_ROOT = path.join(ROOT, '../ocr_services/py_ocr_service');
const PYTHON = path.resolve(args.python || path.join(PY_ROOT, 'python/win32/x64/python.exe'));
const SRC = path.resolve(args.src || path.join(PY_ROOT, 'src'));
const MODELS = path.resolve(args.models || path.join(process.env.APPDATA || '', 'YomiNinja/bin/py_ocr_service/models'));
const IMAGES_DIR = path.resolve(args.images || '.');
const RUNS = Number(args.runs || 5);
const PORT = Number(args.port || 53900);

const proto = grpc.loadPackageDefinition(
    protoLoader.loadSync(path.join(ROOT, '../ocr_services/protos/ocr_service.proto'), { keepCase: true })
).ocr_service;

const call = (client, method, req) => new Promise((resolve, reject) =>
    client[method](req, { deadline: Date.now() + 300000 }, (err, res) => (err ? reject(err) : resolve(res))));

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
    const t0 = performance.now();
    const child = spawn(PYTHON, ['-u', path.join(SRC, 'py_ocr_service.py'), String(PORT)], {
        cwd: SRC,
        env: { ...process.env, CUSTOM_MODULES_PATH: path.join(path.dirname(PYTHON), 'Lib/site-packages'), MODELS_PATH: MODELS },
    });
    let output = '';
    const waitFor = (re) => new Promise((resolve) => {
        const check = () => { const m = output.match(re); if (m) { resolve(m); return true; } return false; };
        if (check()) return;
        const onData = () => { if (check()) { child.stdout.off('data', onData); child.stderr.off('data', onData); } };
        child.stdout.on('data', onData); child.stderr.on('data', onData);
    });
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });

    await waitFor(/\[INFO-JSON\]/);
    console.log(`service up after ${((performance.now() - t0) / 1000).toFixed(1)}s`);

    const client = new proto.OCRService(`127.0.0.1:${PORT}`, grpc.credentials.createInsecure(),
        { 'grpc.max_receive_message_length': 64 * 1024 * 1024, 'grpc.max_send_message_length': 64 * 1024 * 1024 });

    for (const f of fs.readdirSync(IMAGES_DIR).filter((f) => /\.png$/.test(f) && !f.startsWith('crop'))) {
        const jpeg = await sharp(path.join(IMAGES_DIR, f)).jpeg({ quality: 100 }).toBuffer();
        const req = { id: 'bench', language_code: 'ja-JP', image_bytes: jpeg, ocr_engine: 'MangaOCR', detection_only: false };
        let t = performance.now();
        let res = await call(client, 'RecognizeBytes', req);
        const first = performance.now() - t;
        const times = [];
        for (let i = 0; i < RUNS; i++) {
            t = performance.now();
            res = await call(client, 'RecognizeBytes', req);
            times.push(performance.now() - t);
        }
        const text = (res.results || []).flatMap((r) => (r.text_lines || []).map((l) => l.content)).join(' / ');
        console.log(`${f}: first ${first.toFixed(0)}ms, median ${median(times).toFixed(0)}ms (${RUNS} runs)\n  text: ${text}`);
    }

    // Printed by the service when the first request loads the models
    const device = output.match(/ComicTextDetector device: (\w+)/);
    console.log(`detector device: ${device ? device[1] : 'unknown'}`);

    client.close();
    child.kill();
})().catch((e) => { console.error(e); process.exit(1); });
