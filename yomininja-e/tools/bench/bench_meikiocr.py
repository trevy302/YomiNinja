"""
Measures the MeikiOCR service's memory and scan time on generated 4K screens (no window, no screen capture).

Run it with the Python the app uses, so it sees the same packages (GPU builds included):
    %APPDATA%\\YomiNinja\\bin\\py_ocr_service\\python\\python.exe yomininja-e/tools/bench/bench_meikiocr.py

Options:
    --src <dir>             service source (default: ocr_services/py_ocr_service/src of this repo)
    --site-packages <dir>   bundled packages (default: $CUSTOM_MODULES_PATH, else the repo's embedded Python)
    --gpu-batch-size <n>    try another MeikiOcrService.GPU_BATCH_SIZE
    --vertical              also scan vertical-text screens (uses the second recognition model)

Prints, after each stage, the process's committed memory, its RAM (working set) and how much GPU memory was
taken since the start, then the scan times:
    same screen     median of rescanning one screen
    screen changed  each scan has a different number of lines than the one before (the normal case in a game)
"""
import argparse
import ctypes
import hashlib
import os
import subprocess
import sys
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

parser = argparse.ArgumentParser()
parser.add_argument('--src', default=os.path.join(REPO, 'ocr_services', 'py_ocr_service', 'src'))
parser.add_argument('--site-packages', default=os.environ.get('CUSTOM_MODULES_PATH') or os.path.join(
    REPO, 'ocr_services', 'py_ocr_service', 'python', 'win32', 'x64', 'Lib', 'site-packages'))
parser.add_argument('--gpu-batch-size', type=int)
parser.add_argument('--vertical', action='store_true')
args = parser.parse_args()

# Same order as py_ocr_service.py: the service source first, the bundled packages last
os.environ.setdefault('OPENBLAS_NUM_THREADS', '4')
sys.path.insert(0, args.src)
sys.path.append(args.site_packages)


class ProcessMemoryCounters(ctypes.Structure):
    _fields_ = [
        ('cb', ctypes.c_ulong), ('PageFaultCount', ctypes.c_ulong),
        ('PeakWorkingSetSize', ctypes.c_size_t), ('WorkingSetSize', ctypes.c_size_t),
        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
        ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t),
        ('PrivateUsage', ctypes.c_size_t),
    ]


def process_memory_gb():
    """(committed, working set) of this process in GB, or None where it can't be read (not Windows)."""
    if sys.platform != 'win32':
        return None
    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    ctypes.windll.kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(ProcessMemoryCounters), ctypes.c_ulong]
    ctypes.windll.psapi.GetProcessMemoryInfo(
        ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb)
    return counters.PrivateUsage / 2**30, counters.WorkingSetSize / 2**30


def gpu_used_gb():
    """GPU memory in use on the whole first GPU in GB, or None without nvidia-smi."""
    try:
        out = subprocess.check_output(
            ['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], stderr=subprocess.DEVNULL)
        return int(out.decode().split()[0]) / 1024
    except Exception:
        return None


GPU_AT_START = gpu_used_gb()


def report(stage: str):
    memory = process_memory_gb()
    gpu = gpu_used_gb()
    committed = f'{memory[0]:5.2f} GB' if memory else '   n/a'
    ram = f'{memory[1]:5.2f} GB' if memory else '   n/a'
    gpu_delta = f'{gpu - GPU_AT_START:+5.2f} GB' if gpu is not None and GPU_AT_START is not None else '   n/a'
    print(f'{stage:44s} committed {committed}   RAM {ram}   GPU {gpu_delta}', flush=True)


import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', 'YuGothB.ttc')
WIDTH, HEIGHT = 3840, 2160


def horizontal_screen(lines: int) -> np.ndarray:
    image = Image.new('RGB', (WIDTH, HEIGHT), (245, 245, 245))
    draw = ImageDraw.Draw(image)
    columns = 2 if lines > 30 else 1
    per_column = (lines + columns - 1) // columns
    step = (HEIGHT - 80) // per_column
    font = ImageFont.truetype(FONT, min(80, int(step * 0.7)))
    for i in range(lines):
        column, row = divmod(i, per_column)
        draw.text((60 + column * (WIDTH // columns), 40 + row * step),
                  f'第{i + 1}話 トレーナーさん、今日のトレーニングも頑張りましょう！', font=font, fill=(40, 40, 40))
    return np.ascontiguousarray(np.asarray(image)[:, :, ::-1])  # BGR, like the service passes


def vertical_screen(columns: int) -> np.ndarray:
    image = Image.new('RGB', (WIDTH, HEIGHT), (245, 245, 245))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT, 56)
    text = '今日のトレーニングも頑張りましょうスタミナを鍛えておかないと次のレース'
    for column in range(columns):
        x = WIDTH - 120 - column * ((WIDTH - 200) // columns)
        for row, character in enumerate(text[:32]):
            draw.text((x, 60 + row * 62), character, font=font, fill=(40, 40, 40))
    return np.ascontiguousarray(np.asarray(image)[:, :, ::-1])


LINE_COUNTS = [8, 5, 12, 20, 47, 64]
screens = {count: horizontal_screen(count) for count in LINE_COUNTS}
report('start (NumPy + test screens)')

from meiki_ocr_service.meiki_ocr_service import MeikiOcrService

if args.gpu_batch_size:
    MeikiOcrService.GPU_BATCH_SIZE = args.gpu_batch_size

service = MeikiOcrService()
service.init_once()
ocr = service.ocr
report(f'models loaded ({ocr.active_provider}, batch {ocr.max_batch_size})')


def scan(image) -> tuple[float, list]:
    started_at = time.perf_counter()
    lines = ocr.run_ocr(image)
    return (time.perf_counter() - started_at) * 1000, lines


recognized = {}
first = []
for count in LINE_COUNTS:
    elapsed, lines = scan(screens[count])
    recognized[count] = '|'.join(line.get('text', '') for line in lines)
    first.append(f'{count} lines: {elapsed:.0f}')
report('after horizontal screens (5-64 lines)')

same_screen = {}
for count in (8, 20, 64):
    times = sorted(scan(screens[count])[0] for _ in range(7))
    same_screen[count] = times[len(times) // 2]

changed = []
for count in (8, 64, 8, 20, 5, 12, 8, 47, 20):
    changed.append(f'{count} lines: {scan(screens[count])[0]:.0f}')

if args.vertical:
    for columns in (6, 20, 40):
        elapsed, lines = scan(vertical_screen(columns))
        vertical = sum(1 for line in lines if line.get('is_vertical'))
        report(f'after vertical screen ({vertical} vertical lines, {elapsed:.0f} ms)')

report('end')
print()
print('first scan of each screen (ms):  ' + ', '.join(first))
print('same screen, median (ms):        ' + ', '.join(f'{count} lines: {ms:.0f}' for count, ms in same_screen.items()))
print('screen changed (ms):             ' + ', '.join(changed))
# Compare between runs: the recognized text must not depend on the batch size
digest = hashlib.md5('\n'.join(recognized[count] for count in LINE_COUNTS).encode()).hexdigest()[:8]
print(f'recognized text checksum:        {digest}')
