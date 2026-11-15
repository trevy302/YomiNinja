import numpy as np


def pad_batches(run_inference, batch_size: int):
    """
    Wraps meikiocr's `_run_recognition_inference(batch, is_vertical)` so the model always sees `batch_size` images:
    a shorter batch is filled up with blank images, and their results are dropped again.
    A batch of `batch_size` images or more is passed on unchanged (`run_ocr` splits its lines into chunks of
    `max_batch_size`, so with `max_batch_size == batch_size` it never sends more).
    """

    def run_padded(batch, is_vertical):
        if batch is None:
            return run_inference(batch, is_vertical)

        count = len(batch)
        if count >= batch_size:
            return run_inference(batch, is_vertical)

        padding = np.zeros((batch_size - count,) + batch.shape[1:], dtype=batch.dtype)
        outputs = run_inference(np.concatenate([batch, padding], axis=0), is_vertical)
        return [output[:count] for output in outputs]

    return run_padded
