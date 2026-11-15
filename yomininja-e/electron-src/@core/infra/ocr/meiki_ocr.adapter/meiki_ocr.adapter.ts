import { OcrResult } from "../../../domain/ocr_result/ocr_result";
import { OcrAdapter, OcrAdapterStatus, OcrEngineSettingsOptions, OcrRecognitionInput, TextRecognitionModel, UpdateOcrAdapterSettingsOutput } from "../../../application/adapters/ocr.adapter";
import { OcrResultScalable } from "../../../domain/ocr_result_scalable/ocr_result_scalable";
import { MeikiOcrEngineSettings, getMeikiOcrDefaultSettings, meikiOcrAdapterName } from "./meiki_ocr_settings";
import { pyOcrService } from "../ocr_services/py_ocr_service/_temp_index";

// meikiocr runs inside the Python OCR service (ocr_services/py_ocr_service/src/meiki_ocr_service)
export class MeikiOcrAdapter implements OcrAdapter< MeikiOcrEngineSettings > {

    static _name: string = meikiOcrAdapterName;
    public readonly name: string = MeikiOcrAdapter._name;

    private readonly ocrEngineName = 'MeikiOCR';
    private idCounter: number = 0;
    private recognitionCallOnHold: OcrRecognitionInput | undefined;

    private prevImage: Buffer = Buffer.from('');
    private prevResult: OcrResultScalable | null = null;
    private prevResultTime: Date = new Date();

    get status(): OcrAdapterStatus {
        return pyOcrService.status;
    }

    initialize() {}

    async recognize( input: OcrRecognitionInput ): Promise< OcrResultScalable | null > {

        // A request is in flight: keep only the newest one and run it when the current one finishes
        if ( this.status === OcrAdapterStatus.Processing ) {
            this.recognitionCallOnHold = input;
            return null;
        }
        this.recognitionCallOnHold = undefined;

        if ( this.isCacheValid( input.imageBuffer ) )
            return this.prevResult;
        this.prevImage = input.imageBuffer;

        this.idCounter++;

        let result: OcrResult | null = null;
        try {
            result = await pyOcrService.recognize({
                id: this.idCounter.toString() + this.name,
                image: input.imageBuffer,
                languageCode: 'ja-JP',
                ocrEngine: this.ocrEngineName,
            });
        } catch ( error ) {
            console.error( error );
        }

        if ( this.recognitionCallOnHold )
            return await this.recognize( this.recognitionCallOnHold );

        if ( !result ) {
            this.cacheResult( null );
            return null;
        }

        const resultScalable = OcrResultScalable.createFromOcrResult( result );
        resultScalable.ocr_engine_name = this.name;
        resultScalable.language = input.language;
        this.cacheResult( resultScalable );

        return resultScalable;
    }

    async getSupportedLanguages(): Promise< string[] > {
        return [ 'ja-JP' ];
    }

    async getSupportedModels(): Promise< TextRecognitionModel[] > {
        return [];
    }

    async updateSettings(
        settingsUpdate: MeikiOcrEngineSettings,
        oldSettings?: MeikiOcrEngineSettings
    ): Promise< UpdateOcrAdapterSettingsOutput< MeikiOcrEngineSettings > > {

        this.resetCache();

        return {
            settings: settingsUpdate,
            restart: false
        };
    }

    getDefaultSettings(): MeikiOcrEngineSettings {
        return getMeikiOcrDefaultSettings();
    }

    getSettingsOptions(): OcrEngineSettingsOptions {
        throw new Error('MeikiOcrAdapter.getSettingsOptions() not implemented');
    }

    // The Python OCR service is shared with Manga OCR and restarts on its own when needed
    restart( callback: () => void ): void {
        callback();
    }

    private cacheResult( result: OcrResultScalable | null ) {
        this.prevResult = result;
        this.prevResultTime = new Date();
    }

    // Same image within 30 s (e.g. the hotkey pressed twice): return the previous result
    private isCacheValid( image: Buffer ): boolean {
        const ageSeconds = ( Date.now() - this.prevResultTime.getTime() ) / 1000;
        return ageSeconds <= 30 && Boolean( this.prevImage?.equals?.( image ) );
    }

    private resetCache() {
        this.prevImage = Buffer.from('');
    }
}
