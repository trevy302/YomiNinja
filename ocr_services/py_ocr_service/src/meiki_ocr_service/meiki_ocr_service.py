import threading
import time
from typing import List

import cv2
import numpy as np
from PIL import Image

from ocr_service_pb2 import Box, Vertex, TextLine, Result, RecognizeDefaultResponse

try:
    # A CUDA build of PyTorch (installed for Manga OCR's GPU support) ships the CUDA 12 / cuDNN 9 libraries that
    # onnxruntime-gpu needs. Importing it first puts them on the DLL search path.
    import torch  # noqa: F401
except ImportError:
    pass

import onnxruntime as ort
from meikiocr import MeikiOCR
from meikiocr.ocr import INPUT_REC_HEIGHT, INPUT_REC_WIDTH

from meiki_ocr_service.batch_padding import pad_batches


class MeikiOcrService:
    """
    meikiocr (https://github.com/rtr46/meikiocr): detection + recognition models trained on Japanese video game
    text. On real Umamusume screenshots it had ~2% character errors vs ~7% for PaddleOCR v4, and runs a full
    4K frame in ~30-80 ms on an RTX 4090 (~0.1-1 s on CPU).
    """

    # On the GPU, lines are recognized in batches of exactly this size (the last one padded with blank images).
    # - Memory: the GPU memory a batch needs stays allocated for the life of the process, and on Windows it also
    #   counts as committed memory. One batch of 64 lines held ~5 GB (plus more for vertical text); 16 holds ~1 GB.
    # - Speed: a batch whose size differs from the previous one takes 100-250 ms longer, and the number of lines
    #   changes on almost every scan of a game. With a fixed size that never happens.
    # A dense 64-line screen takes 4 passes instead of 1 (~350 ms instead of ~290 ms when rescanning the same
    # screen). 32 halves that gap for ~0.7 GB more. Measure with yomininja-e/tools/bench/bench_meikiocr.py.
    GPU_BATCH_SIZE = 16

    # On the CPU a padded batch would only waste time. The detector returns at most 64 lines, so 64 recognizes
    # any frame in one pass.
    CPU_BATCH_SIZE = 64

    # Allocate only what a run asks for, instead of growing the GPU memory pool in doubling steps
    CUDA_PROVIDER_OPTIONS = {'arena_extend_strategy': 'kSameAsRequested'}

    def __init__(self) -> None:
        self.ocr: MeikiOCR | None = None
        self._init_lock = threading.Lock()

    def init_once(self):
        if self.ocr:
            return
        with self._init_lock:
            if self.ocr:
                return
            use_gpu = 'CUDAExecutionProvider' in ort.get_available_providers()
            ocr = MeikiOCR(
                provider='CUDAExecutionProvider' if use_gpu else None,
                max_batch_size=self.GPU_BATCH_SIZE if use_gpu else self.CPU_BATCH_SIZE,
            )
            if ocr.active_provider == 'CUDAExecutionProvider':
                # meikiocr only takes a provider name, so the options are applied to the sessions it created
                for session in (ocr.det_session, ocr.rec_session, ocr.vrec_session):
                    session.set_providers(['CUDAExecutionProvider'], [self.CUDA_PROVIDER_OPTIONS])
                ocr._run_recognition_inference = pad_batches(ocr._run_recognition_inference, self.GPU_BATCH_SIZE)
            print(f'MeikiOCR provider: {ocr.active_provider}, batch size: {ocr.max_batch_size}')
            self.ocr = ocr

    # Loads the models (downloading them from Hugging Face on first use) and runs a tiny inference in the
    # background, so the first scan doesn't pay for it.
    def warm_up(self):
        def run():
            try:
                started_at = time.perf_counter()
                self.init_once()
                self.ocr.run_ocr(np.full((64, 256, 3), 255, dtype=np.uint8))
                # The blank image has no text, so the line above only ran the detector. Run the horizontal
                # recognizer too (the vertical one is rarely needed and loads its GPU memory on first use).
                blank_line = np.zeros((1, 3, INPUT_REC_HEIGHT, INPUT_REC_WIDTH), dtype=np.float32)
                self.ocr._run_recognition_inference(blank_line, False)
                print(f'MeikiOCR warm-up done ({(time.perf_counter() - started_at) * 1000:.0f}ms, provider: {self.ocr.active_provider})')
            except Exception as error:
                print(f'MeikiOCR warm-up failed: {error}')

        threading.Thread(target=run, daemon=True).start()

    def recognize(self, image: Image.Image, request_id: str, image_bytes: bytes | None = None) -> RecognizeDefaultResponse:

        self.init_once()

        # meikiocr expects OpenCV's BGR order. Decoding the encoded bytes straight to BGR takes ~30 ms for a 4K
        # frame, vs ~85 ms for PIL decode + RGB array + BGR copy.
        bgr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR) if image_bytes else None
        if bgr is None:
            rgb = np.asarray(image.convert('RGB'))
            bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        height, width = bgr.shape[:2]

        results: List[Result] = []

        for line in self.ocr.run_ocr(bgr):
            text = line.get('text') or ''
            boxes = [c['bbox'] for c in line.get('chars', []) if c.get('bbox')]
            if not text or not boxes:
                continue

            box = self.to_box(
                min(b[0] for b in boxes), min(b[1] for b in boxes),
                max(b[2] for b in boxes), max(b[3] for b in boxes),
            )
            confidences = [c['conf'] for c in line['chars'] if 'conf' in c]

            results.append(Result(
                box=box,
                text_lines=[TextLine(content=text, box=box)],
                is_vertical=bool(line.get('is_vertical')),
                recognition_score=float(np.mean(confidences)) if confidences else 1.0,
                recognition_state='RECOGNIZED',
            ))

        return RecognizeDefaultResponse(
            id=request_id,
            results=results,
            context_resolution={'width': width, 'height': height},
        )

    @staticmethod
    def to_box(x1, y1, x2, y2) -> Box:
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        return Box(
            top_left=Vertex(x=x1, y=y1),
            top_right=Vertex(x=x2, y=y1),
            bottom_right=Vertex(x=x2, y=y2),
            bottom_left=Vertex(x=x1, y=y2),
        )
