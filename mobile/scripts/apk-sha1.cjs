#!/usr/bin/env node
/**
 * Print the SHA-1 (and SHA-256) signing fingerprint of an Android APK.
 * Use this value in Google Cloud Console → OAuth client → Android → SHA-1.
 *
 * Usage:
 *   node scripts/apk-sha1.cjs path/to/app.apk
 *   npm run apk:sha1 -- path/to/app.apk
 */
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

function readU32(buf, offset) {
  return buf.readUInt32LE(offset);
}

function readU64(buf, offset) {
  return Number(buf.readBigUInt64LE(offset));
}

function takePrefixed(buf, offset) {
  const len = readU32(buf, offset);
  const start = offset + 4;
  const end = start + len;
  return { slice: buf.subarray(start, end), next: end };
}

function colonHex(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function findSigningBlock(data) {
  const eocdMagic = Buffer.from('PK\x05\x06');
  const eocd = data.lastIndexOf(eocdMagic);
  if (eocd < 0) throw new Error('Not a valid ZIP/APK (EOCD missing).');
  const cd = readU32(data, eocd + 16);
  const magic = Buffer.from('APK Sig Block 42');
  if (!data.subarray(cd - 16, cd).equals(magic)) {
    throw new Error('APK Signature Scheme v2/v3 block not found (is this APK signed?).');
  }
  const size2 = readU64(data, cd - 24);
  const start = cd - size2 - 8;
  const size1 = readU64(data, start);
  if (size1 !== size2) throw new Error('Corrupt APK signing block size.');
  return { start, end: cd - 24 };
}

function extractCerts(data) {
  const { start, end } = findSigningBlock(data);
  const certs = [];
  let pos = start + 8;
  while (pos < end) {
    const length = readU64(data, pos);
    const idOff = pos + 8;
    const id = readU32(data, idOff);
    const value = data.subarray(idOff + 4, idOff + length);
    // 0x7109871a = APK Signature Scheme v2
    if (id === 0x7109871a) {
      const signersWrapped = takePrefixed(value, 0);
      let j = 0;
      const list = signersWrapped.slice;
      while (j < list.length) {
        const signer = takePrefixed(list, j);
        j = signer.next;
        const signedData = takePrefixed(signer.slice, 0);
        const digests = takePrefixed(signedData.slice, 0);
        const certsSection = takePrefixed(signedData.slice, digests.next);
        let c = 0;
        while (c < certsSection.slice.length) {
          const cert = takePrefixed(certsSection.slice, c);
          c = cert.next;
          certs.push(Buffer.from(cert.slice));
        }
      }
    }
    pos = idOff + length;
  }
  return certs;
}

function main() {
  const apkPath = process.argv[2];
  if (!apkPath) {
    console.error('Usage: node scripts/apk-sha1.cjs <path-to.apk>');
    process.exit(1);
  }
  const resolved = path.resolve(apkPath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }
  const data = fs.readFileSync(resolved);
  const certs = extractCerts(data);
  if (!certs.length) {
    console.error('No signing certificates found in APK.');
    process.exit(1);
  }
  console.log(`APK: ${resolved}`);
  console.log(`Package (expected): com.studybuddy.ai`);
  certs.forEach((cert, i) => {
    const sha1 = createHash('sha1').update(cert).digest();
    const sha256 = createHash('sha256').update(cert).digest();
    console.log(`\nSigner #${i + 1}`);
    console.log(`SHA-1:   ${colonHex(sha1)}`);
    console.log(`SHA-256: ${colonHex(sha256)}`);
  });
  console.log(`
Add the SHA-1 to Google Cloud Console:
  APIs & Services → Credentials → Create OAuth client ID → Android
  Package name: com.studybuddy.ai
  SHA-1: (value above)
`);
}

main();
