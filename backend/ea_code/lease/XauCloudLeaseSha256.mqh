//+------------------------------------------------------------------+
//| XauCloudLeaseSha256.mqh                                          |
//|                                                                    |
//| Pure-MQL5 SHA-256 (FIPS 180-4), written from scratch because this |
//| MQL5 build's built-in CryptEncode() does NOT support CRYPT_SHA256 |
//| (or CRYPT_SHA1/CRYPT_MD5) -- confirmed empirically by compiling a  |
//| probe script against this exact MetaEditor build, not assumed     |
//| from general MQL5 documentation. Only CRYPT_BASE64/CRYPT_AES256   |
//| compiled; hashing is unsupported. See                             |
//| audits/offline_lease/04_ea_crypto_module.md for the compile log.  |
//|                                                                    |
//| The algorithm below was first validated against Python's hashlib  |
//| and the official NIST FIPS 180-4 test vectors before being        |
//| transliterated here -- see the Python prototype referenced in     |
//| that same audit doc.                                              |
//+------------------------------------------------------------------+
#property strict

uint XAU_SHA256_K[64] =
{
   0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
   0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
   0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
   0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
   0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
   0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
   0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
   0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

uint XAU_SHA256_H0[8] =
{
   0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
};

uint XAU_Sha256Rotr(uint x, int n)
{
   return (uint)((x >> n) | (x << (32 - n)));
}

// data[] is the raw message bytes. hashOut[] is resized to 32 bytes.
void XAU_Sha256Compute(const uchar &data[], uchar &hashOut[])
{
   int dataLen = ArraySize(data);
   ulong origBitLen = (ulong)dataLen * 8;

   int paddedLen = dataLen + 1;
   while((paddedLen % 64) != 56) paddedLen++;
   paddedLen += 8;

   uchar msg[];
   ArrayResize(msg, paddedLen);
   for(int i = 0; i < dataLen; i++) msg[i] = data[i];
   msg[dataLen] = 0x80;
   for(int i = dataLen + 1; i < paddedLen - 8; i++) msg[i] = 0;
   for(int i = 0; i < 8; i++)
      msg[paddedLen - 1 - i] = (uchar)((origBitLen >> (8 * i)) & 0xFF);

   uint h[8];
   for(int i = 0; i < 8; i++) h[i] = XAU_SHA256_H0[i];

   uint w[64];
   for(int chunkStart = 0; chunkStart < paddedLen; chunkStart += 64)
   {
      for(int i = 0; i < 16; i++)
      {
         int p = chunkStart + i * 4;
         w[i] = ((uint)msg[p] << 24) | ((uint)msg[p + 1] << 16) | ((uint)msg[p + 2] << 8) | ((uint)msg[p + 3]);
      }
      for(int i = 16; i < 64; i++)
      {
         uint s0 = XAU_Sha256Rotr(w[i - 15], 7) ^ XAU_Sha256Rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
         uint s1 = XAU_Sha256Rotr(w[i - 2], 17) ^ XAU_Sha256Rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
         w[i] = (uint)(w[i - 16] + s0 + w[i - 7] + s1);
      }

      uint a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for(int i = 0; i < 64; i++)
      {
         uint S1 = XAU_Sha256Rotr(e, 6) ^ XAU_Sha256Rotr(e, 11) ^ XAU_Sha256Rotr(e, 25);
         uint ch = (e & f) ^ ((~e) & g);
         uint temp1 = (uint)(hh + S1 + ch + XAU_SHA256_K[i] + w[i]);
         uint S0 = XAU_Sha256Rotr(a, 2) ^ XAU_Sha256Rotr(a, 13) ^ XAU_Sha256Rotr(a, 22);
         uint maj = (a & b) ^ (a & c) ^ (b & c);
         uint temp2 = (uint)(S0 + maj);
         hh = g;
         g = f;
         f = e;
         e = (uint)(d + temp1);
         d = c;
         c = b;
         b = a;
         a = (uint)(temp1 + temp2);
      }

      h[0] = (uint)(h[0] + a);
      h[1] = (uint)(h[1] + b);
      h[2] = (uint)(h[2] + c);
      h[3] = (uint)(h[3] + d);
      h[4] = (uint)(h[4] + e);
      h[5] = (uint)(h[5] + f);
      h[6] = (uint)(h[6] + g);
      h[7] = (uint)(h[7] + hh);
   }

   ArrayResize(hashOut, 32);
   for(int i = 0; i < 8; i++)
   {
      hashOut[i * 4 + 0] = (uchar)((h[i] >> 24) & 0xFF);
      hashOut[i * 4 + 1] = (uchar)((h[i] >> 16) & 0xFF);
      hashOut[i * 4 + 2] = (uchar)((h[i] >> 8) & 0xFF);
      hashOut[i * 4 + 3] = (uchar)(h[i] & 0xFF);
   }
}
