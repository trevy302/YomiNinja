import { getWindowCrop, intersectRects } from "./frame_crop";
import { cropToPixels } from "../../renderer/utils/frame_crop";

const display4k = { x: 0, y: 0, width: 3840, height: 2160 };

describe( 'intersectRects', () => {
    it( 'returns the overlap', () => {
        expect( intersectRects(
            { x: -100, y: 50, width: 300, height: 100 },
            { x: 0, y: 0, width: 1000, height: 1000 }
        )).toStrictEqual({ x: 0, y: 50, width: 200, height: 100 });
    });

    it( 'returns undefined without overlap', () => {
        expect( intersectRects(
            { x: 2000, y: 0, width: 100, height: 100 },
            { x: 0, y: 0, width: 1000, height: 1000 }
        )).toBeUndefined();
    });
});

describe( 'getWindowCrop', () => {

    it( 'crops to a 1080p window on a 4K display', () => {
        const result = getWindowCrop( { x: 960, y: 540, width: 1920, height: 1080 }, display4k );
        expect( result?.window ).toStrictEqual({ x: 960, y: 540, width: 1920, height: 1080 });
        expect( result?.crop ).toStrictEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    });

    it( 'clips a window that is partly off the display', () => {
        const result = getWindowCrop( { x: -200, y: 1700, width: 1000, height: 800 }, display4k );
        expect( result?.window ).toStrictEqual({ x: 0, y: 1700, width: 800, height: 460 });
        expect( result?.crop.x ).toBe( 0 );
        expect( result?.crop.height ).toBeCloseTo( 460 / 2160 );
    });

    it( 'is relative to the display origin', () => {
        const display = { x: 3840, y: 0, width: 1920, height: 1080 };
        const result = getWindowCrop( { x: 4320, y: 270, width: 960, height: 540 }, display );
        expect( result?.crop ).toStrictEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    });

    it( 'captures the whole display for fullscreen windows', () => {
        expect( getWindowCrop( display4k, display4k ) ).toBeUndefined();
        // Exclusive fullscreen / borderless windows often extend a few pixels past the display
        expect( getWindowCrop( { x: -8, y: -8, width: 3856, height: 2176 }, display4k ) ).toBeUndefined();
    });

    it( 'captures the whole display for minimized or tiny windows', () => {
        expect( getWindowCrop( { x: -32000, y: -32000, width: 160, height: 28 }, display4k ) ).toBeUndefined();
        expect( getWindowCrop( { x: 100, y: 100, width: 40, height: 300 }, display4k ) ).toBeUndefined();
    });
});

describe( 'cropToPixels', () => {

    it( 'scales the crop to the frame', () => {
        expect( cropToPixels( { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 3840, 2160 ) )
            .toStrictEqual({ x: 960, y: 540, width: 1920, height: 1080 });
        // A frame streamed at a lower resolution than the display
        expect( cropToPixels( { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 1920, 1080 ) )
            .toStrictEqual({ x: 480, y: 270, width: 960, height: 540 });
    });

    it( 'clamps to the frame', () => {
        expect( cropToPixels( { x: -0.1, y: 0.9, width: 0.5, height: 0.5 }, 1000, 1000 ) )
            .toStrictEqual({ x: 0, y: 900, width: 400, height: 100 });
    });

    it( 'returns undefined when there is nothing to crop', () => {
        expect( cropToPixels( undefined, 1000, 1000 ) ).toBeUndefined();
        expect( cropToPixels( { x: 0, y: 0, width: 1, height: 1 }, 1000, 1000 ) ).toBeUndefined();
        expect( cropToPixels( { x: 0.5, y: 0.5, width: 0, height: 0.2 }, 1000, 1000 ) ).toBeUndefined();
        expect( cropToPixels( { x: 2, y: 0, width: 0.5, height: 0.5 }, 1000, 1000 ) ).toBeUndefined();
        expect( cropToPixels( { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 0, 1000 ) ).toBeUndefined();
    });
});
