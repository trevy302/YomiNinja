import numpy as np
import cv2
import torch
from typing import List

import comic_text_detector.inference as ctd_inference
from comic_text_detector.inference import TextDetector

# TextDetector always refines the text mask (refine_mask) after finding the text blocks. Only the blocks are
# used here, and they don't depend on the refined mask, so skip that work: ~130 ms per 4K frame on CPU,
# with identical boxes (measured). Nothing in this process uses the refined mask.
if hasattr( ctd_inference, 'refine_mask' ):
    ctd_inference.refine_mask = lambda img, mask, blk_list, refine_mode=None: mask

class TextLine:
    coordinates = []
    def __init__(self, coordinates = []) -> None:
        self.coordinates = coordinates

class TextBlock:
    is_vertical: bool = False
    coordinates: List
    lines: List[TextLine]

    def __init__(
        self,
        is_vertical = False,
        coordinates = [],
        lines: List[TextLine] = []
    ):

        self.is_vertical = is_vertical
        self.coordinates = coordinates
        self.lines = lines

class ComicTextDetector:

    text_detector: TextDetector = None

    def __init__(
        self,
        model_path = '../models/comic_text_detector/comictextdetector.pt'
    ):
        # Use the GPU when a CUDA build of PyTorch is installed (Manga OCR's recognizer does the same)
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print( f'ComicTextDetector device: {self.device}' )
        self.text_detector = TextDetector(model_path, input_size=1024, device=self.device, act='leaky')


    def detect(self, image: np.ndarray) -> List[TextBlock]:

        result: List[TextBlock] = []

        mask, mask_refined, blk_list = self.text_detector(image, refine_mode=1, keep_undetected_mask=False)


        for blk_idx, blk in enumerate(blk_list):

            is_vertical = blk.vertical

            block_rect = [ int(x.item()) for x in blk.bounding_rect() ]

            block_coordinates = self.rect_to_box_points( block_rect, blk.angle )

            text_block = TextBlock( is_vertical, block_coordinates, [] ) # Not adding an empty list of lines can cause a reference issue

            lines = blk.lines_array()

            # print(f'Block {blk_idx+1} | Number of lines: {len(lines)}')

            for line in lines:
                line = TextLine(line.tolist())
                text_block.lines.append(line)

            result.append(text_block)

        # self.display_result( image, result )

        return result

    def rect_to_box_points(self, rect, angle):
        x, y, w, h = rect

        center_x = x + w / 2
        center_y = y + h / 2

        rot_rect = ((center_x, center_y), (w, h), angle)
        
        points = np.int0(cv2.boxPoints(rot_rect))

        return [
            points[1],
            points[2],
            points[3],
            points[0]
        ]
    
    def display_result(self, image, text_blocks: List[TextBlock]):

        for block in text_blocks:

            block_coordinates = [ (int(x), int(y)) for x, y in block.coordinates ]

            # Convert list of points to numpy array
            pts = np.array(block_coordinates, np.int32)
            pts = pts.reshape((-1, 1, 2))
            
            # Draw the Block on the image
            cv2.polylines(image, [pts], isClosed=True, color=(255, 255, 0), thickness=4)

            for line in block.lines:

                line_coordinates = [ (int(x), int(y)) for x, y in line.coordinates ]

                # Convert list of points to numpy array
                pts = np.array(line_coordinates, np.int32)
                pts = pts.reshape((-1, 1, 2))
                
                # Draw the Line on the image
                cv2.polylines(image, [pts], isClosed=True, color=(0, 255, 0), thickness=2)
        
        cv2.imshow("Image", image)
        cv2.waitKey(0)
        cv2.destroyAllWindows()