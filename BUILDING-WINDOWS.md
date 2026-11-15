# Building YomiNinja on Windows (x64)

This fork's `security-hardening` branch builds a full Windows installer. The upstream README leaves out several
inputs that the build needs, so this file lists every step that was used to build it.

## What this fork changes

- The local HTTP/Socket.IO server (port 10010), the texthooker WebSocket (6677) and the Python OCR
  gRPC service now listen on `127.0.0.1` only, not on every network interface.
- Requests to the local server must use a loopback `Host` (this blocks DNS rebinding) and come from a trusted
  `Origin`: localhost pages, in-app extensions, or non-browser local clients. Before this change, any website could
  open a Socket.IO connection and call every IPC handler.
- The static file handler refuses paths outside the pages directory (`/../../` path traversal).
- `open_link` only opens `http:`/`https:` URLs.

Not covered: the prebuilt PaddleOCR engine (`ppocr_infer_service_grpc.exe`) takes no host argument, so its
gRPC port can't be restricted from here. It only runs OCR on images sent to it.

## Prerequisites

- **Visual Studio 2022 Build Tools** with the *Desktop development with C++* workload. This includes MSVC v143 and
  the Windows SDK. `@electron/node-gyp` 10.x does not recognize Visual Studio 2026.
  ```
  winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --override "--passive --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```
- **Node 22**, the Node version that Electron 36 ships. With fnm: `fnm install 22`, then put it first on `PATH` for every
  step below. On Windows, `fnm exec` can't launch `npm.cmd`.
- **7-Zip**, **git** and the **GitHub CLI** (`gh`).

All commands are run from Git Bash. Paths are relative to the repo root.

## 1. Node dependencies

```
cd yomininja-e
npm ci --force        # --force: peer-dep conflict (reflect-metadata) + macOS-only dmg-license
```
`postinstall` rebuilds the native modules for Electron. These are `extract-file-icon`, `node-window-manager`,
`sqlite3`, `uiohook-napi` and the repo's own window manager addon.

## 2. Embedded Python for the OCR service

```
PY=ocr_services/py_ocr_service/python/win32/x64
mkdir -p $PY/Lib/site-packages
# python.org embeddable package, SHA-256 4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3
curl -LO https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip
7z x -o$PY python-3.12.10-embed-amd64.zip
curl -L -o $PY/get-pip.py https://bootstrap.pypa.io/get-pip.py
printf 'setuptools\r\nnumpy==1.26.4\r\n' > $PY/requirements.txt
```
Replace `$PY/python312._pth` with:
```
Lib/site-packages
lib/site-packages
python312.zip
##pre-installed-modules
.

# Uncomment to run site.main() automatically
import site
```
Then install pip and the pinned packages. These are the same versions as the official 0.9.3 build; see
`ocr_services/py_ocr_service/requirements-win-x64-pinned.txt`:
```
cd $PY
./python.exe -I get-pip.py
./python.exe -I -m pip install --only-binary :all: setuptools==80.9.0 wheel
./python.exe -I -m pip install --only-binary :all: --no-binary jaconv,pyperclip,unidic-lite --no-build-isolation \
    -r ../../../requirements-win-x64-pinned.txt
# MeikiOCR engine. --no-deps: its declared opencv-python-headless would clash with the bundled opencv-python;
# everything else it needs (numpy, opencv, huggingface_hub, onnxruntime) is already pinned above.
./python.exe -I -m pip install --no-deps meikiocr==0.3.5
```
Only `jaconv`, `pyperclip` and `unidic-lite` build from source, because they have no wheels. Build isolation doesn't
work with the embeddable Python, which is why `--no-build-isolation` is used.

## 3. Python gRPC code, comic text detector and its model

```
cd ocr_services/py_ocr_service
./python/win32/x64/python.exe -I -m grpc_tools.protoc -I../protos --python_out=./src --pyi_out=./src --grpc_python_out=./src ../protos/ocr_service.proto
git clone https://github.com/kha-white/comic-text-detector.git src/comic_text_detector
mkdir -p models/comic_text_detector
gh release download beta-0.2.1 -R zyddnys/manga-image-translator -p comictextdetector.pt -D models/comic_text_detector
# SHA-256 1f90fa60aeeb1eb82e2ac1167a66bf139a8a61b8780acd351ead55268540cccb (identical to the official build's copy)
```

Assemble the service the way `ocr_services/py_ocr_service/build-win32-x64.bat` does:
```
DST=bin/win32/x64/py_ocr_service
mkdir -p $DST/models
cp -r ocr_services/py_ocr_service/python/win32/x64 $DST/python
cp -r ocr_services/py_ocr_service/models/comic_text_detector $DST/models/
cp -r ocr_services/py_ocr_service/src $DST/src
cp ocr_services/py_ocr_service/run.bat $DST/src/run.bat
```

## 4. PaddleOCR engine

The official 0.9.3 app ships a PPOCR-Inference-Service build that is newer than the latest published binary
(v0.3.0). That newer build corresponds to the source-only tag `v0.4.0`, which uses the ONNX backend. Building it
means compiling FastDeploy/Paddle, so this build copies `resources/bin/ppocr` out of the official installer
without running the installer:
```
7z e YomiNinja.Setup.0.9.3.exe '$PLUGINSDIR/app-64.7z'
7z x app-64.7z 'resources/bin/ppocr/*'
cp -r resources/bin/ppocr bin/win32/x64/ppocr
```

## 5. Google Lens protos

The Lens adapter in use needs `yomininja-e/grpc/lens_proto/*.proto`, which upstream keeps out of the repo. Use
Chromium's `third_party/lens_server_proto` at commit `c96ea6263cfdf7f0c366339cc2b2814aafba991f` (June 2025, which
matches when the adapter was last updated):
```
cd yomininja-e/grpc/lens_proto     # create it first
SHA=c96ea6263cfdf7f0c366339cc2b2814aafba991f
for f in $(gh api "repos/chromium/chromium/contents/third_party/lens_server_proto?ref=$SHA" --jq '.[] | select(.name|endswith(".proto")) | .name'); do
  gh api "repos/chromium/chromium/contents/third_party/lens_server_proto/$f?ref=$SHA" -H "Accept: application/vnd.github.raw" > "$f"
done
cd ../..
npm run grpc-types
npm run grpc-lens-types       # also runs patches/fix_lens_types.js (pbts bug with a message named "Object")
```

## 6. Remaining inputs

- **Test credentials placeholder.** The spec files import a gitignored file, and `tsc -p electron-src` compiles
  the spec files too. Create `yomininja-e/electron-src/@core/infra/ocr/cloud_vision_ocr.adapter/test/test_data.ts`:
  ```ts
  export const cloudVisionToken = "";
  export const proxyUrl = "";
  ```
- **Bundled extensions** go in `yomininja-e/extensions/`. Their contents are identical to the official build's copies:
  ```
  gh release download 25.7.14.1 -R yomidevs/yomitan -p yomitan-chrome.zip -O yomininja-e/extensions/yomitan-chrome-25.7.14.1.zip
  gh release download v1.25.1 -R birchill/10ten-ja-reader -p 10ten-ja-reader-1.25.1-chrome-electron.zip -D yomininja-e/extensions
  ```

## 7. Build

```
cd yomininja-e
npm run dist
```
If electron-builder fails to unpack `winCodeSign` with *"Cannot create symbolic link: A required privilege is not
held"*, the cause is two macOS symlinks in that archive. Unpack it yourself without symlinks, then rerun
`npm run dist:x64`:
```
C="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
7z x -snl- -o"$C/winCodeSign-2.6.0" "$C"/<downloaded-number>.7z
```
The installer is written to `yomininja-e/dist/`. It's unsigned, so SmartScreen will warn on first run.

For faster iteration, skip the installer and only update `dist/win-unpacked`:
```
npm run build-renderer && npm run build-electron
npx cross-env TARGET_ARCH=x64 electron-builder --dir --config electron-builder.config.js
```

## Measuring performance

**In the app.** Every scan logs one line with the time spent in each stage since the hotkey press. Start the
app with `ELECTRON_ENABLE_LOGGING=1` to see it on the console:
```
[ocr-timing] total=1020ms | debounce=51 grab=219 debounce=0 source=0 bounds=1 engine=744 json=1 send=4 overlay=0 | PpOcrAdapter
```
- `grab` is the screenshot.
- `engine` is the OCR engine.
- The screen-capture page also logs `[grab-timing]`, which splits `grab` into frame wait, draw and JPEG encode.

**OCR engines on their own** (`yomininja-e/tools/bench/`):
```
# Test images with known Japanese text (any Python with Pillow)
ocr_services/py_ocr_service/python/win32/x64/python.exe -I yomininja-e/tools/bench/make_bench_image.py <dir> 3840 2160

cd yomininja-e
# PaddleOCR: runtimes/thread counts, latency + character error rate; --load N simulates a game using N threads
node tools/bench/bench_ppocr.js --images <dir> --matrix full --load 8
# Manga OCR through the Python service (use --python <python.exe> to test another environment, e.g. CUDA PyTorch)
node tools/bench/bench_mangaocr.js --images <dir>
```

Reference numbers, 4K screenshot, i9-14900HX + RTX 4090 Laptop GPU:

| Engine | Before | After |
|---|---|---|
| PaddleOCR (engine only) | ONNX, 32 threads: ~1.5 s, up to 4 s in the app | OpenVINO, 8 threads: ~0.25 s (bench), 0.7–0.9 s (text-heavy desktop) |
| Manga OCR, full recognition | 27.6 s (CPU) | 2.0 s (CPU), 0.57 s (CUDA) |
| Screenshot (`grab`) | up to ~810 ms | 108–276 ms |

**OCR engines on real Umamusume screenshots** (6 Steam store screenshots: menus, story log, subtitles over 3D
scenes; upscaled to 3840x2160 like a 4K screen capture; character error rate vs. a manual transcription;
RTX 4090 Laptop GPU / i9-14900HX):

| Engine | Errors | Typical | Dense screen (60+ lines) |
|---|---|---|---|
| Google Lens (cloud) | 0.1% | ~720 ms | ~780 ms |
| **MeikiOCR, GPU** (batch 64) | 2.2% | ~30–60 ms | ~80 ms |
| MeikiOCR, CPU | 2.2% | ~120 ms | ~1 s |
| PP-OCRv6 medium, GPU (RapidOCR, not integrated) | 2.8% | ~270 ms | ~1 s |
| PaddleOCR v4 (bundled engine, OpenVINO) | 7.3% | ~420 ms | ~3 s |
| PP-OCRv5 server, GPU (RapidOCR, not integrated) | 10.3% | ~330 ms | ~1.4 s |
| Manga OCR, GPU | 43% | ~210 ms | ~1.9 s |

Manga OCR's comic text detector misses most subtitle and narration lines in games.

**GPU for Manga OCR and MeikiOCR.** With YomiNinja closed, install the CUDA builds into the Python environment the
app uses (`%APPDATA%\YomiNinja\bin\py_ocr_service\python`). Packages installed there take precedence over the
bundled CPU builds:
```
python.exe -I -m pip install --no-deps torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
python.exe -I -m pip install --no-deps onnxruntime-gpu==1.26.0
```
- Versions are pinned because the in-app installer pulls the newest PyTorch, which may not match the bundled
  `transformers`.
- `--no-deps` keeps the bundled dependencies, such as NumPy 1.26.
- onnxruntime-gpu 1.26.0 is the newest release built for CUDA 12. 1.27+ need CUDA 13 libraries. It uses the CUDA 12 /
  cuDNN 9 libraries that ship with the CUDA build of PyTorch, so nothing else is needed.

The YomiNinja installer deletes that folder, so do this after (re)installing.
