// Browser-independent SHA-256 / git-blob SHA-1. HTTP Tavern origins may lack SubtleCrypto.
const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
export function hashBytes(bytes, algorithm = 'SHA-256') {
    const size = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(size); padded.set(bytes); padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(size - 4, (bytes.length * 8) >>> 0);
    const sha1 = algorithm === 'SHA-1';
    const state = sha1 ? [0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0] : [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Uint32Array(sha1 ? 80 : 64);
    for (let offset = 0; offset < size; offset += 64) {
        for (let j = 0; j < 16; j++) w[j] = view.getUint32(offset + j * 4);
        if (sha1) {
            for (let j = 16; j < 80; j++) w[j] = rotate(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16],31);
            let [a,b,c,d,e] = state;
            for (let j = 0; j < 80; j++) {
                const f = j < 20 ? ((b & c) | (~b & d)) : j < 40 ? (b ^ c ^ d) : j < 60 ? ((b & c) | (b & d) | (c & d)) : (b ^ c ^ d);
                const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6;
                const t = (rotate(a,27) + f + e + k + w[j]) | 0;
                e=d; d=c; c=rotate(b,2); b=a; a=t;
            }
            [a,b,c,d,e].forEach((n,i) => { state[i] = (state[i] + n) | 0; });
        } else {
            for (let j = 16; j < 64; j++) {
                const a=w[j-15], b=w[j-2];
                w[j] = w[j-16] + (rotate(a,7)^rotate(a,18)^(a>>>3)) + w[j-7] + (rotate(b,17)^rotate(b,19)^(b>>>10));
            }
            let [a,b,c,d,e,f,g,h] = state;
            for (let j = 0; j < 64; j++) {
                const t1 = (h + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + K[j] + w[j]) | 0;
                const t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c))) | 0;
                h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
            }
            [a,b,c,d,e,f,g,h].forEach((n,i) => { state[i] = (state[i] + n) | 0; });
        }
    }
    return state.map(n => (n >>> 0).toString(16).padStart(8,'0')).join('');
}
