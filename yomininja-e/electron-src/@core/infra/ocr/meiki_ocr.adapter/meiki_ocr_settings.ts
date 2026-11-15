import { OcrEngineSettings } from "../../../domain/settings_preset/settings_preset";

// For preventing 'electron-is-dev' issues when testing with jest
export const meikiOcrAdapterName = 'MeikiOcrAdapter';

// meikiocr (https://github.com/rtr46/meikiocr): local OCR trained on Japanese video game text.
// Runs on the GPU when onnxruntime-gpu and a CUDA build of PyTorch are installed in the OCR service's Python.
export interface MeikiOcrEngineSettings extends OcrEngineSettings {};

export function getMeikiOcrDefaultSettings(): MeikiOcrEngineSettings {
    return {
        ocr_adapter_name: meikiOcrAdapterName,
        hotkey: 'Alt+M',
        image_scaling_factor: 1,
        invert_colors: false,
    };
}
