import { OcrEngineSettings } from "../../../domain/settings_preset/settings_preset";
import { applyCpuHotfix } from "./hotfix/hardware_compatibility_hotfix";
import os from 'os';

// This for preventing import 'electron-is-dev' issues when testing with jest
export const ppOcrAdapterName = 'PpOcrAdapter';

export interface PpOcrEngineSettings extends OcrEngineSettings {
    max_image_width: number;
    cpu_threads: number;
    inference_runtime: string;
    det_db_thresh: number; // Only pixels with a score greater than this threshold will be considered as text pixels
    det_db_box_thresh: number; // When the average score of all pixels is greater than the threshold, the result will be considered as a text area
    det_db_unclip_ratio: number; // Expansion factor of the Vatti clipping algorithm, which is used to expand the text area
    det_db_score_mode: 'slow' | 'fast'; // DB detection result score calculation method
    use_dilation: boolean; // Whether to inflate the segmentation results to obtain better detection results
    cls_thresh: number; // Prediction threshold, when the model prediction result is 180 degrees, and the score is greater than the threshold, the final prediction result is considered to be 180 degrees and needs to be flipped
};

// Language code the PaddleOCR engine expects (it picks its language preset by this code).
// Never send an empty code: the engine process crashes on it.
export function getPpOcrLanguageCode( language: { bcp47_tag?: string, two_letter_code: string } ): string {
    if ( language.two_letter_code === 'en' )
        return 'en';
    return language.bcp47_tag || language.two_letter_code;
}

export function getPpOcrDefaultSettings() {
    
    const defaultSettings: PpOcrEngineSettings = {
        ocr_adapter_name: ppOcrAdapterName,
        hotkey: 'Alt+D',
        image_scaling_factor: 1,
        max_image_width: 1600,
        // More threads don't help. Benchmarked on a 4K screenshot (i9-14900HX, 32 logical CPUs):
        // OpenVINO is fastest at 8 threads, and using every logical CPU slows ONNX down, especially
        // when a game is also using the CPU. See tools/bench/bench_ppocr.js.
        cpu_threads: Math.min( os.cpus().length, 8 ),
        invert_colors: false,
        // OpenVINO measured ~250 ms per 4K frame vs ~1.5 s for ONNX with the same accuracy, and stays stable
        // under background CPU load. applyCpuHotfix() below switches Ryzen 7000+ CPUs back to ONNX.
        inference_runtime: 'Open_VINO', // Open_VINO | ONNX_CPU
        det_db_thresh: 0.3,
        det_db_box_thresh: 0.6,
        det_db_unclip_ratio: 1.6,
        det_db_score_mode: "slow",
        use_dilation: false,
        cls_thresh: 0.9,
    }

    const result = applyCpuHotfix( defaultSettings );

    return result.ocrEngineSettings;
}