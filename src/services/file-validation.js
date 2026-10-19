const ALLOWED_SIGNATURES = {
  'application/pdf': (buffer) => buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/jpeg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

function validateFileSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer)) return false;
  const check = ALLOWED_SIGNATURES[mimeType];
  return typeof check === 'function' && check(buffer);
}

module.exports = { validateFileSignature };
