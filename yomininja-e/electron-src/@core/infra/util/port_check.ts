import net from 'net';


export async function isPortInUse( port: number, host = '0.0.0.0' ): Promise< boolean > {
    return new Promise(( resolve, reject ) => {
    
        const client = new net.Socket();
    
        client.connect( port, host, () => {
            resolve(true);
            client.end();
            client.destroy();
        });
    
        client.on('error', (err) => {
            resolve(false);
            client.end();
            client.destroy();
        });
    });
}

// Resolves true if something accepts connections on 127.0.0.1:port. Refused connections fail within a few ms.
function isAcceptingOnLoopback( port: number, timeoutMs = 1000 ): Promise< boolean > {
    return new Promise( resolve => {
        const client = net.connect({ port, host: '127.0.0.1' });
        const done = ( inUse: boolean ) => {
            clearTimeout( timer );
            client.destroy();
            resolve( inUse );
        };
        const timer = setTimeout( () => done( false ), timeoutMs );
        client.once( 'connect', () => done( true ) );
        client.once( 'error', () => done( false ) );
    });
}

export async function isPortAvailable( port: number, host = '127.0.0.1' ): Promise< boolean > {

    // Windows allows binding 127.0.0.1:port while another process listens on 0.0.0.0:port (as the PaddleOCR
    // engine does), so a successful test bind alone doesn't prove the port is free. Anything listening there,
    // on any interface, also accepts loopback connections.
    if ( await isAcceptingOnLoopback( port ) )
        return false;

    return new Promise( (resolve, reject) => {

        const server = net.createServer((socket) => {
            socket.on( 'connect', () => socket.end() );
        });
    
        server.on( 'error', ( e ) => {
            console.log(e.message);
            server.close();
            resolve(false);
        });
      
        server.listen( port, host, () => {
            server.close();
            resolve(true);
        });
    });
}

export async function getNextPortAvailable( port: number, host = '127.0.0.1' ): Promise< number | undefined > {

    while( port < 65_535 ) {

        const isAvailable = await isPortAvailable( port, host );

        if ( isAvailable ) return port;

        port++;
    }

    return;
}