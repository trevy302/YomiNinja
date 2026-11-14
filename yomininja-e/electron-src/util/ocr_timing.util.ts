import { performance } from 'perf_hooks';

// Follows one OCR request from the hotkey press to the results reaching the overlay, and logs a single line:
//   [ocr-timing] total=412ms | debounce=51 grab=118 debounce=50 source=3 bounds=9 engine=163 json=12 send=1 overlay=5
// Each stage is the time since the previous mark. A new hotkey press starts a new trace.
class OcrTiming {

    private startedAt: number | undefined;
    private lastMarkAt = 0;
    private stages: [ string, number ][] = [];

    get active(): boolean {
        return this.startedAt !== undefined;
    }

    begin() {
        this.startedAt = performance.now();
        this.lastMarkAt = this.startedAt;
        this.stages = [];
    }

    mark( stage: string ) {
        if ( this.startedAt === undefined ) return;
        const now = performance.now();
        this.stages.push([ stage, now - this.lastMarkAt ]);
        this.lastMarkAt = now;
    }

    end( note?: string ) {
        if ( this.startedAt === undefined ) return;
        this.mark( 'overlay' );
        const total = this.lastMarkAt - this.startedAt;
        const stages = this.stages.map( ([ name, ms ]) => `${name}=${ms.toFixed(0)}` ).join(' ');
        console.log(`[ocr-timing] total=${total.toFixed(0)}ms | ${stages}${ note ? ' | ' + note : '' }`);
        this.startedAt = undefined;
    }
}

export const ocrTiming = new OcrTiming();
