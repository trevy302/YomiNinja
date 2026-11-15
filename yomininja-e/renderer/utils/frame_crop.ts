// Applies the crop computed by electron-src/screen_capturer/frame_crop.ts to a captured frame.
// (The renderer can't bundle code from electron-src, only import its types.)
import type { FrameCrop, Rect } from "../../electron-src/screen_capturer/frame_crop";

// Converts a FrameCrop to whole pixels of a frame of the given size, clamped to the frame.
// Undefined when there's nothing to crop (no crop, an empty one, or one covering the whole frame).
export function cropToPixels(
    crop: FrameCrop | undefined,
    frameWidth: number,
    frameHeight: number
): Rect | undefined {

    if ( !crop || frameWidth <= 0 || frameHeight <= 0 )
        return;

    const left = Math.max( 0, Math.round( crop.x * frameWidth ) );
    const top = Math.max( 0, Math.round( crop.y * frameHeight ) );
    const right = Math.min( frameWidth, Math.round( ( crop.x + crop.width ) * frameWidth ) );
    const bottom = Math.min( frameHeight, Math.round( ( crop.y + crop.height ) * frameHeight ) );

    if ( right <= left || bottom <= top )
        return;

    if ( left === 0 && top === 0 && right === frameWidth && bottom === frameHeight )
        return;

    return { x: left, y: top, width: right - left, height: bottom - top };
}
