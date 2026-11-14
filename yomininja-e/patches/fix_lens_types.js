// pbts mis-generates type references to nested messages named "Object"
// (e.g. lens.LensOverlayInteractionRequestMetadata.SelectionMetadata.Object),
// writing them as ".object", which breaks `tsc -p grpc`. The generated
// JavaScript is correct; only the .d.ts needs fixing.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../grpc/rpc/lens/lens_pb.d.ts');

const contents = fs.readFileSync(file, 'utf-8');
const fixed = contents.replace(
    /SelectionMetadata\.object(?=[;|)>, ])/g,
    'SelectionMetadata.Object'
);

fs.writeFileSync(file, fixed, 'utf-8');
