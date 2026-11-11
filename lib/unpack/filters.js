'use strict';
// Post-decompression filters shared by xz and 7z.

// Delta (distance 1..256): out[i] = in[i] + out[i - distance]. 7-Zip uses it for WAV audio.
function deltaFilter(distance, onData) {
  const hist = new Uint8Array(256);
  let hp = 0;
  return (chunk) => {
    const out = new Uint8Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      const b = (chunk[i] + hist[(hp - distance) & 255]) & 255;
      hist[hp] = b;
      hp = (hp + 1) & 255;
      out[i] = b;
    }
    onData(out);
  };
}

module.exports = { deltaFilter };
