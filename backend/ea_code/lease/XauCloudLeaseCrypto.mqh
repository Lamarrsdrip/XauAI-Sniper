//+------------------------------------------------------------------+
//| XauCloudLeaseCrypto.mqh                                          |
//|                                                                    |
//| Isolated, self-contained pure-MQL5 signature verification module |
//| for the XauCloud bounded offline trading lease.                  |
//|                                                                    |
//| Scheme: XAUCLOUD-LEASE-RS256-v1                                  |
//|   RSA-2048, public exponent e=65537 (fixed, never read from any  |
//|   untrusted input), SHA-256, PKCS#1 v1.5 padding (RFC 8017 /      |
//|   RFC 3447). This is a RESTRICTED single-algorithm profile, not  |
//|   general JWS: `signature_algorithm` on an incoming lease is     |
//|   checked against exactly this one string and nothing else is    |
//|   ever attempted -- there is no algorithm negotiation and no     |
//|   `alg` value is ever taken from the payload to decide how to    |
//|   verify it.                                                     |
//|                                                                    |
//| Why RSA instead of Ed25519: Ed25519 needs full Edwards-curve     |
//| point arithmetic (point add/double, cofactor clearing, encoding/ |
//| decoding with sign-bit recovery via modular square root) with no |
//| existing MQL5 implementation anywhere in this codebase to build  |
//| on (confirmed by repo-wide search -- see                          |
//| audits/offline_lease/03_lease_architecture.md). RSA verification |
//| needs only modular exponentiation (schoolbook multiply + a       |
//| mechanical bit-serial binary reduction, no quotient-digit        |
//| estimation) -- far fewer places for a translation bug to hide.   |
//| The exact algorithm below was first validated in Python against  |
//| real RSA-2048 signatures produced by the `cryptography` library  |
//| (the actual backend signer) -- see                                |
//| /audits/offline_lease/ for the cross-check and test vectors.     |
//|                                                                    |
//| Hashing was originally planned to use MQL5's built-in             |
//| CryptEncode(CRYPT_SHA256, ...) intrinsic rather than a hand-rolled|
//| SHA-256. That plan was tested, not assumed: a probe script was    |
//| compiled against this exact MetaEditor build and CRYPT_SHA256 (as |
//| well as CRYPT_SHA1/CRYPT_MD5) is an undeclared identifier --      |
//| this build's CryptEncode only supports CRYPT_BASE64/CRYPT_AES256. |
//| See audits/offline_lease/04_ea_crypto_module.md for the compile   |
//| log. SHA-256 is therefore implemented from scratch in the sibling |
//| file XauCloudLeaseSha256.mqh, validated against Python's hashlib  |
//| and the official NIST FIPS 180-4 test vectors before being        |
//| transliterated -- see the same audit doc.                         |
//|                                                                    |
//| The EA may only ever VERIFY a lease with this module. There is   |
//| no signing function here, and none should ever be added -- the  |
//| private key lives only on the backend (see                       |
//| XAUCLOUD_LEASE_SIGNING_PRIVATE_KEY in backend/.env.example).     |
//+------------------------------------------------------------------+
#property strict

#include "XauCloudLeaseSha256.mqh"

#define XAU_LEASE_LIMB_BITS      32
#define XAU_LEASE_NUM_LIMBS      64      // 2048-bit RSA modulus / signature width
#define XAU_LEASE_MOD_BYTES      256     // 2048 bits / 8
#define XAU_LEASE_HASH_BYTES     32      // SHA-256 digest size
#define XAU_LEASE_PUBLIC_EXP     65537   // fixed exponent, never read from input

// RFC 8017 / RFC 3447 well-known DER DigestInfo prefix for SHA-256
// (0x30 0x31 0x30 0x0d 0x06 0x09 0x60 0x86 0x48 0x01 0x65 0x03 0x04 0x02 0x01 0x05 0x00 0x04 0x20)
uchar XAU_LEASE_SHA256_DIGESTINFO_PREFIX[19] =
{
   0x30,0x31,0x30,0x0d,0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x02,0x01,0x05,0x00,0x04,0x20
};

const string XAU_LEASE_ALGORITHM_ID = "XAUCLOUD-LEASE-RS256-v1";

//+------------------------------------------------------------------+
//| Bignum core -- little-endian arrays of 32-bit limbs, exactly    |
//| mirroring the algorithm validated in Python (see the prototype  |
//| referenced above). Every function here operates on plain,       |
//| already-sized uint[] arrays; callers own allocation.             |
//+------------------------------------------------------------------+

// Compare two equal-length limb arrays. Returns -1, 0, or 1.
int XAU_BigCmp(const uint &a[], const uint &b[], int len)
{
   for(int i = len - 1; i >= 0; i--)
   {
      if(a[i] != b[i])
         return (a[i] < b[i]) ? -1 : 1;
   }
   return 0;
}

// a -= b, in place, equal length, caller guarantees a >= b.
void XAU_BigSubInPlace(uint &a[], const uint &b[], int len)
{
   long borrow = 0;
   for(int i = 0; i < len; i++)
   {
      long cur = (long)a[i] - (long)b[i] - borrow;
      if(cur < 0)
      {
         cur += ((long)1 << XAU_LEASE_LIMB_BITS);
         borrow = 1;
      }
      else
      {
         borrow = 0;
      }
      a[i] = (uint)cur;
   }
}

// Shift a whole limb array left by 1 bit, in place. Returns the bit
// shifted out past the top of the array (0 or 1).
int XAU_BigShl1(uint &a[], int len)
{
   uint carry = 0;
   for(int i = 0; i < len; i++)
   {
      uint newCarry = (a[i] >> (XAU_LEASE_LIMB_BITS - 1)) & 1;
      a[i] = (uint)(((ulong)a[i] << 1) | carry) & 0xFFFFFFFF;
      carry = newCarry;
   }
   return (int)carry;
}

// Read bit `bitIndex` (0 = least significant) out of a limb array of
// length `len`, MSB-first callers index down from productBits-1.
int XAU_BigGetBit(const uint &a[], int len, int bitIndex)
{
   int limb = bitIndex / XAU_LEASE_LIMB_BITS;
   int off  = bitIndex % XAU_LEASE_LIMB_BITS;
   if(limb >= len)
      return 0;
   return (int)((a[limb] >> off) & 1);
}

// Schoolbook multiply: a (lenA limbs) * b (lenB limbs) -> result
// (must be pre-sized to at least lenA+lenB limbs, zero-initialized).
void XAU_BigMul(const uint &a[], int lenA, const uint &b[], int lenB, uint &result[])
{
   for(int i = 0; i < lenA + lenB; i++) result[i] = 0;
   for(int i = 0; i < lenA; i++)
   {
      if(a[i] == 0) continue;
      ulong carry = 0;
      ulong ai = (ulong)a[i];
      for(int j = 0; j < lenB; j++)
      {
         ulong cur = (ulong)result[i + j] + ai * (ulong)b[j] + carry;
         result[i + j] = (uint)(cur & 0xFFFFFFFF);
         carry = cur >> XAU_LEASE_LIMB_BITS;
      }
      int k = i + lenB;
      while(carry != 0)
      {
         ulong cur = (ulong)result[k] + carry;
         result[k] = (uint)(cur & 0xFFFFFFFF);
         carry = cur >> XAU_LEASE_LIMB_BITS;
         k++;
      }
   }
}

// product (little-endian, productBits significant bits) mod modulus
// (XAU_LEASE_NUM_LIMBS limbs) -> remainder (XAU_LEASE_NUM_LIMBS limbs,
// pre-sized by caller). Binary long-division-style: one bit of the
// product at a time, MSB first, remainder = remainder*2 + bit; if
// remainder >= modulus, remainder -= modulus. Purely mechanical --
// no quotient-digit estimation -- deliberately chosen over a faster
// Knuth-style division for auditability (see module header comment).
//
// The remainder register is kept at NUM_LIMBS+1 limbs (one extra limb
// of headroom): remainder*2+bit can transiently need one more bit than
// the modulus itself before the conditional subtraction brings it back
// under the modulus. Sizing it at exactly NUM_LIMBS overflows -- this
// was caught by the Python prototype (see audits/offline_lease/) before
// ever being written here.
void XAU_BigMod(const uint &product[], int productBits, const uint &modulus[], uint &remainder[])
{
   int extLen = XAU_LEASE_NUM_LIMBS + 1;
   uint rem[];
   ArrayResize(rem, extLen);
   for(int i = 0; i < extLen; i++) rem[i] = 0;

   uint modExt[];
   ArrayResize(modExt, extLen);
   for(int i = 0; i < XAU_LEASE_NUM_LIMBS; i++) modExt[i] = modulus[i];
   modExt[XAU_LEASE_NUM_LIMBS] = 0;

   for(int bitIndex = productBits - 1; bitIndex >= 0; bitIndex--)
   {
      int carry = XAU_BigShl1(rem, extLen);
      // carry must be 0: if it isn't, productBits/modulus width
      // assumptions were violated -- fail closed rather than continue
      // with a corrupted remainder.
      if(carry != 0)
      {
         for(int i = 0; i < XAU_LEASE_NUM_LIMBS; i++) remainder[i] = 0xFFFFFFFF; // poison value, never a valid PKCS1 block
         return;
      }
      rem[0] |= (uint)XAU_BigGetBit(product, (int)ArraySize(product), bitIndex);
      if(XAU_BigCmp(rem, modExt, extLen) >= 0)
         XAU_BigSubInPlace(rem, modExt, extLen);
   }
   for(int i = 0; i < XAU_LEASE_NUM_LIMBS; i++) remainder[i] = rem[i];
}

// (a * b) mod modulus, all XAU_LEASE_NUM_LIMBS-limb operands.
void XAU_BigMulMod(const uint &a[], const uint &b[], const uint &modulus[], uint &result[])
{
   uint product[];
   ArrayResize(product, XAU_LEASE_NUM_LIMBS * 2);
   XAU_BigMul(a, XAU_LEASE_NUM_LIMBS, b, XAU_LEASE_NUM_LIMBS, product);
   XAU_BigMod(product, XAU_LEASE_NUM_LIMBS * 2 * XAU_LEASE_LIMB_BITS, modulus, result);
}

// base^exponent mod modulus. exponent is a small, fixed, compile-time
// constant in every real call site (XAU_LEASE_PUBLIC_EXP = 65537) --
// never derived from the lease payload -- so a plain right-to-left
// square-and-multiply over its (constant) bit pattern is safe and
// simple; there is no attacker-controlled exponent to worry about.
void XAU_BigModExp(const uint &base[], uint exponent, const uint &modulus[], uint &result[])
{
   uint resultAcc[];
   ArrayResize(resultAcc, XAU_LEASE_NUM_LIMBS);
   for(int i = 0; i < XAU_LEASE_NUM_LIMBS; i++) resultAcc[i] = 0;
   resultAcc[0] = 1;

   uint baseAcc[];
   ArrayResize(baseAcc, XAU_LEASE_NUM_LIMBS);
   ArrayCopy(baseAcc, base);

   uint e = exponent;
   uint tmp[];
   ArrayResize(tmp, XAU_LEASE_NUM_LIMBS);

   while(e > 0)
   {
      if((e & 1) != 0)
      {
         XAU_BigMulMod(resultAcc, baseAcc, modulus, tmp);
         ArrayCopy(resultAcc, tmp);
      }
      XAU_BigMulMod(baseAcc, baseAcc, modulus, tmp);
      ArrayCopy(baseAcc, tmp);
      e >>= 1;
   }
   ArrayCopy(result, resultAcc);
}

//+------------------------------------------------------------------+
//| Byte-array <-> bignum-limb-array conversion                      |
//+------------------------------------------------------------------+

// Big-endian byte array (as received over the wire / parsed from hex)
// -> little-endian uint-limb array of exactly XAU_LEASE_NUM_LIMBS
// limbs. `bytes[]` must be exactly XAU_LEASE_MOD_BYTES long.
bool XAU_BytesToLimbs(const uchar &bytesBE[], uint &limbs[])
{
   if(ArraySize(bytesBE) != XAU_LEASE_MOD_BYTES)
      return false;
   ArrayResize(limbs, XAU_LEASE_NUM_LIMBS);
   for(int limb = 0; limb < XAU_LEASE_NUM_LIMBS; limb++)
   {
      int hi = XAU_LEASE_MOD_BYTES - 1 - (limb * 4);
      uint v = 0;
      v |= ((uint)bytesBE[hi - 0]) << 0;
      v |= ((uint)bytesBE[hi - 1]) << 8;
      v |= ((uint)bytesBE[hi - 2]) << 16;
      v |= ((uint)bytesBE[hi - 3]) << 24;
      limbs[limb] = v;
   }
   return true;
}

// Little-endian uint-limb array (XAU_LEASE_NUM_LIMBS limbs) -> a fixed
// XAU_LEASE_MOD_BYTES-long big-endian byte array (leading-zero padded,
// matching the modulus width, exactly as PKCS#1 requires).
void XAU_LimbsToBytesBE(const uint &limbs[], uchar &outBytes[])
{
   ArrayResize(outBytes, XAU_LEASE_MOD_BYTES);
   for(int limb = 0; limb < XAU_LEASE_NUM_LIMBS; limb++)
   {
      int hi = XAU_LEASE_MOD_BYTES - 1 - (limb * 4);
      uint v = limbs[limb];
      outBytes[hi - 0] = (uchar)(v & 0xFF);
      outBytes[hi - 1] = (uchar)((v >> 8) & 0xFF);
      outBytes[hi - 2] = (uchar)((v >> 16) & 0xFF);
      outBytes[hi - 3] = (uchar)((v >> 24) & 0xFF);
   }
}

// Parse a hex string (no "0x" prefix, even length, upper or lower case)
// into a byte array. Returns false on any malformed character or odd
// length -- fails closed rather than silently truncating/guessing.
bool XAU_HexToBytes(const string &hex, uchar &outBytes[])
{
   int len = StringLen(hex);
   if(len == 0 || (len % 2) != 0)
      return false;
   ArrayResize(outBytes, len / 2);
   for(int i = 0; i < len; i += 2)
   {
      int hi = XAU_HexNibble(StringGetCharacter(hex, i));
      int lo = XAU_HexNibble(StringGetCharacter(hex, i + 1));
      if(hi < 0 || lo < 0)
         return false;
      outBytes[i / 2] = (uchar)((hi << 4) | lo);
   }
   return true;
}

int XAU_HexNibble(ushort c)
{
   if(c >= '0' && c <= '9') return c - '0';
   if(c >= 'a' && c <= 'f') return c - 'a' + 10;
   if(c >= 'A' && c <= 'F') return c - 'A' + 10;
   return -1;
}

//+------------------------------------------------------------------+
//| SHA-256 -- see XauCloudLeaseSha256.mqh (hand-written, since this |
//| build's CryptEncode does not support any hash mode -- verified,  |
//| not assumed).                                                     |
//+------------------------------------------------------------------+
bool XAU_LeaseSHA256(const uchar &data[], uchar &hashOut[])
{
   XAU_Sha256Compute(data, hashOut);
   return ArraySize(hashOut) == XAU_LEASE_HASH_BYTES;
}

//+------------------------------------------------------------------+
//| Top-level verification entry point.                              |
//|                                                                    |
//| canonicalPayload: the exact byte sequence that was signed (UTF-8  |
//|   bytes of the canonical lease JSON/string -- byte-for-byte the   |
//|   same construction the backend used to sign, see                |
//|   audits/offline_lease/03_lease_architecture.md for the exact     |
//|   canonicalization rule).                                        |
//| signatureHex: 512 hex chars (256 bytes) -- the detached signature.|
//| modulusHex: 512 hex chars (256 bytes) -- the RSA public modulus n |
//|   for the key_id the lease claims to be signed with. The caller   |
//|   (not this module) is responsible for looking up the correct    |
//|   public key by key_id from XAU_LEASE_TRUSTED_PUBLIC_KEYS and     |
//|   MUST refuse to call this function at all for an unknown key_id  |
//|   -- this module has no concept of key_id, it only ever checks    |
//|   one modulus against one signature.                             |
//| algorithmId: must exactly equal XAU_LEASE_ALGORITHM_ID. This is   |
//|   the ONLY algorithm ever attempted -- there is no branch on any  |
//|   other value, by design (no algorithm confusion possible).      |
//+------------------------------------------------------------------+
bool XAU_LeaseVerifySignature(const uchar &canonicalPayload[], const string &signatureHex,
                               const string &modulusHex, const string &algorithmId)
{
   if(algorithmId != XAU_LEASE_ALGORITHM_ID)
      return false; // fail closed on any unrecognized/unexpected algorithm id

   uchar sigBytes[], modBytes[];
   if(!XAU_HexToBytes(signatureHex, sigBytes)) return false;
   if(!XAU_HexToBytes(modulusHex, modBytes))   return false;
   if(ArraySize(sigBytes) != XAU_LEASE_MOD_BYTES) return false;
   if(ArraySize(modBytes) != XAU_LEASE_MOD_BYTES) return false;

   uint sigLimbs[], modLimbs[];
   if(!XAU_BytesToLimbs(sigBytes, sigLimbs)) return false;
   if(!XAU_BytesToLimbs(modBytes, modLimbs)) return false;

   // Reject a signature/modulus that isn't actually reduced (sig >= n) --
   // a malleable/malformed encoding should never even reach modexp.
   if(XAU_BigCmp(sigLimbs, modLimbs, XAU_LEASE_NUM_LIMBS) >= 0)
      return false;

   uint decoded[];
   ArrayResize(decoded, XAU_LEASE_NUM_LIMBS);
   XAU_BigModExp(sigLimbs, XAU_LEASE_PUBLIC_EXP, modLimbs, decoded);

   uchar decodedBytes[];
   XAU_LimbsToBytesBE(decoded, decodedBytes);

   uchar hash[];
   if(!XAU_LeaseSHA256(canonicalPayload, hash)) return false;

   // Build the expected EMSA-PKCS1-v1_5 block:
   //   0x00 0x01 (0xFF * padLen) 0x00 || DigestInfo(SHA-256) || hash
   int suffixLen = 19 + XAU_LEASE_HASH_BYTES; // DigestInfo prefix + hash
   int padLen = XAU_LEASE_MOD_BYTES - 3 - suffixLen;
   if(padLen < 8) return false; // sanity floor per RFC 8017 4.2 note

   if(decodedBytes[0] != 0x00) return false;
   if(decodedBytes[1] != 0x01) return false;
   for(int i = 0; i < padLen; i++)
   {
      if(decodedBytes[2 + i] != 0xFF) return false;
   }
   if(decodedBytes[2 + padLen] != 0x00) return false;

   int digestInfoOffset = 3 + padLen;
   for(int i = 0; i < 19; i++)
   {
      if(decodedBytes[digestInfoOffset + i] != XAU_LEASE_SHA256_DIGESTINFO_PREFIX[i])
         return false;
   }
   int hashOffset = digestInfoOffset + 19;
   for(int i = 0; i < XAU_LEASE_HASH_BYTES; i++)
   {
      if(decodedBytes[hashOffset + i] != hash[i])
         return false;
   }
   return true;
}
