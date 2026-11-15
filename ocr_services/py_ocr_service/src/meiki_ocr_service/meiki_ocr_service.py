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


class MeikiOcrService:
    """
    meikiocr (https://github.com/rtr46/meikiocr): detection + recognition models trained on Japanese video game
    text. On real Umamusume screenshots it had ~2% character errors vs ~7% for PaddleOCR v4, and runs a full
    4K frame in ~30-80 ms on an RTX 4090 (~0.1-1 s on CPU).
    """

    # The detector returns at most 64 lines, so a batch of 64 recognizes any frame in one GPU pass
    # (dense screen: ~250 ms with the library's default of 8, ~80 ms with 64).
    MAX_BATCH_SIZE = 64

    def __init__(self) -> None:
        self.ocr: MeikiOCR | None = None
        self._init_lock = threading.Lock()

    def init_once(self):
        if self.ocr:
            return
        with self._init_lock:
            if self.ocr:
                return
            provider = 'CUDAExecutionProvider' if 'CUDAExecutionProvider' in ort.get_available_providers() else None
            ocr = MeikiOCR(provider=provider, max_batch_size=self.MAX_BATCH_SIZE)
            print(f'MeikiOCR provider: {ocr.active_provider}')
            self.ocr = ocr

    # Loads the models (downloading them from Hugging Face on first use) and runs a tiny inference in the
    # background, so the first scan doesn't pay for it.
    def warm_up(self):
        def run():
            try:
                started_at = time.perf_counter()
                self.init_once()
                self.ocr.run_ocr(np.full((64, 256, 3), 255, dtype=np.uint8))
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
