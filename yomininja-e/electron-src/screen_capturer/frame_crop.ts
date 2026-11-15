// The screen-capturer page applies the crop with renderer/utils/frame_crop.ts (it can only import types from here).

export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

// A region of a captured frame, as fractions (0..1) of the frame's width and height
export type FrameCrop = Rect;

// Windows this small (or minimized, which Windows reports at -32000) aren't worth cropping to
const MIN_WINDOW_SIZE = 64;

// A window covering at least this much of the display is treated as fullscreen: capture the whole display
const FULLSCREEN_AREA_RATIO = 0.95;

export function intersectRects( a: Rect, b: Rect ): Rect | undefined {
    const x = Math.max( a.x, b.x );
    const y = Math.max( a.y, b.y );
    const right = Math.min( a.x + a.width, b.x + b.width );
    const bottom = Math.min( a.y + a.height, b.y + b.height );

    if ( right <= x || bottom <= y )
        return;

    return { x, y, width: right - x, height: bottom - y };
}

// Where to crop a capture of `display` so it only contains `window`. Both rects are in the same (physical
// pixel) screen coordinates. Undefined when the whole display should be captured instead: the window is
// off the display, tiny/minimized, or (nearly) fullscreen.
// `window` is the part of the window on the display, which is also where the overlay should go.
export function getWindowCrop(
    window: Rect,
    display: Rect
): { window: Rect, crop: FrameCrop } | undefined {

    if ( display.width <= 0 || display.height <= 0 )
        return;

    const visible = intersectRects( window, display );

    if (
        !visible ||
        visible.width < MIN_WINDOW_SIZE ||
        visible.height < MIN_WINDOW_SIZE
    )
        return;

    const areaRatio = ( visible.width * visible.height ) / ( display.width * display.height );
    if ( areaRatio >= FULLSCREEN_AREA_RATIO )
        return;

    return {
        window: visible,
        crop: {
            x: ( visible.x - display.x ) / display.width,
            y: ( visible.y - display.y ) / display.height,
            width: visible.width / display.width,
            height: visible.height / display.height,
        }
    };
}
