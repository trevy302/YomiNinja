import sharp from 'sharp';
import { GoogleLensOcrGrpcAdapter } from './google_lens_ocr_grpc.adapter';

jest.mock( 'electron', () => ({ session: {} }) );

describe( 'GoogleLensOcrGrpcAdapter.rescaleImage', () => {

    const adapter = new GoogleLensOcrGrpcAdapter();

    const image = ( width: number, height: number, format: 'png' | 'jpeg' = 'jpeg' ) =>
        sharp({ create: { width, height, channels: 3, background: '#808080' } })
            .toFormat( format )
            .toBuffer();

    const sizeOf = async ( buffer: Buffer ) => {
        const { width, height, format } = await sharp( buffer ).metadata();
        return { width, height, format };
    };

    it( 'fits a landscape 4K frame into the max dimension, keeping the aspect ratio', async () => {
        const result = await adapter.rescaleImage( await image( 3840, 2160 ), 1_000_000, 1000 );
        expect( result.size ).toEqual({ width: 1000, height: 562 });
        expect( await sizeOf( result.image ) ).toEqual({ width: 1000, height: 562, format: 'jpeg' });
    });

    it( 'fits a portrait image into the max dimension (width scaled too)', async () => {
        const result = await adapter.rescaleImage( await image( 1000, 3000 ), 1_000_000, 1000 );
        expect( result.size ).toEqual({ width: 333, height: 1000 });
        expect( await sizeOf( result.image ) ).toEqual({ width: 333, height: 1000, format: 'jpeg' });
    });

    it( 'applies the area limit without distorting the image', async () => {
        const result = await adapter.rescaleImage( await image( 3000, 1500 ), 1_000_000, 10_000 );
        expect( result.size.width * result.size.height ).toBeLessThanOrEqual( 1_000_000 );
        expect( result.size.width / result.size.height ).toBeCloseTo( 2, 1 );
    });

    it( 'returns a small JPEG unchanged', async () => {
        const input = await image( 800, 600 );
        const result = await adapter.rescaleImage( input, 1_000_000, 1000 );
        expect( result.image ).toBe( input );
        expect( result.size ).toEqual({ width: 800, height: 600 });
    });

    it( 'converts a small PNG to JPEG without resizing', async () => {
        const result = await adapter.rescaleImage( await image( 800, 600, 'png' ), 1_000_000, 1000 );
        expect( await sizeOf( result.image ) ).toEqual({ width: 800, height: 600, format: 'jpeg' });
    });
});
