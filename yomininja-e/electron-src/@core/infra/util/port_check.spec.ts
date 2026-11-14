import net from 'net';
import { getNextPortAvailable, isPortAvailable } from './port_check';

describe( 'port_check', () => {

    let server: net.Server;
    let busyPort: number;

    beforeAll( async () => {
        server = net.createServer();
        await new Promise< void >( resolve => server.listen( 0, '127.0.0.1', resolve ) );
        busyPort = ( server.address() as net.AddressInfo ).port;
    });

    afterAll( () => new Promise< void >( resolve => server.close( () => resolve() ) ) );

    it( 'reports a port with a listener as unavailable', async () => {
        expect( await isPortAvailable( busyPort ) ).toBe( false );
    });

    it( 'reports a free port as available', async () => {
        const probe = net.createServer();
        await new Promise< void >( resolve => probe.listen( 0, '127.0.0.1', resolve ) );
        const freePort = ( probe.address() as net.AddressInfo ).port;
        await new Promise< void >( resolve => probe.close( () => resolve() ) );

        expect( await isPortAvailable( freePort ) ).toBe( true );
    });

    it( 'skips ports that are in use', async () => {
        const port = await getNextPortAvailable( busyPort );
        expect( port ).toBeDefined();
        expect( port ).not.toBe( busyPort );
    });
});
