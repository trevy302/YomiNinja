

export interface CaptureSource {
    id: string;
    displayId?: number;
    name: string;
    type: 'screen' | 'window';
    window?: ExternalWindow;
    // Streams the screen, but each OCR only reads the window that's in the foreground
    activeWindow?: boolean;
}

export type ExternalWindow = {
    id: number;
    name: string;
    size: {
        width: number,
        height: number
    },
    position: {
        x: number,
        y: number
    }
}