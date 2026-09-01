"""
Prototype + cross-check for the XauCloud lease signature scheme:
RSA-2048, SHA-256, PKCS#1 v1.5 padding ("XAUCLOUD-LEASE-RS256-v1").

Validates the exact bit-serial bignum algorithm (schoolbook multiply +
binary shift-subtract modular reduction) that will be ported 1:1 to
pure MQL5 (which has no native bignum/modexp), using a REAL key pair
and REAL signatures produced by Python's `cryptography` library (the
actual backend signer) as ground truth.
"""
import struct
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization

LIMB_BITS = 32
LIMB_MASK = (1 << LIMB_BITS) - 1
NUM_LIMBS = 64  # 2048 bits / 32

SHA256_DIGESTINFO_PREFIX = bytes.fromhex(
    "3031300d060960864801650304020105000420"
)  # RFC 8017 / RFC 3447 well-known DigestInfo prefix for SHA-256, 19 bytes


def to_limbs(n: int, num_limbs=NUM_LIMBS):
    limbs = [0] * num_limbs
    for i in range(num_limbs):
        limbs[i] = n & LIMB_MASK
        n >>= LIMB_BITS
    assert n == 0, "value too large for limb width"
    return limbs


def from_limbs(limbs):
    n = 0
    for i in reversed(range(len(limbs))):
        n = (n << LIMB_BITS) | limbs[i]
    return n


def bignum_mul(a, b):
    """Schoolbook multiply, little-endian limb arrays -> double-width result."""
    result = [0] * (len(a) + len(b))
    for i in range(len(a)):
        carry = 0
        ai = a[i]
        if ai == 0:
            continue
        for j in range(len(b)):
            cur = result[i + j] + ai * b[j] + carry
            result[i + j] = cur & LIMB_MASK
            carry = cur >> LIMB_BITS
        k = i + len(b)
        while carry:
            cur = result[k] + carry
            result[k] = cur & LIMB_MASK
            carry = cur >> LIMB_BITS
            k += 1
    return result


def bignum_cmp(a, b):
    """Compare equal-length little-endian limb arrays. -1/0/1."""
    for i in reversed(range(len(a))):
        if a[i] != b[i]:
            return -1 if a[i] < b[i] else 1
    return 0


def bignum_sub_inplace(a, b):
    """a -= b, equal length, assumes a >= b. In place."""
    borrow = 0
    for i in range(len(a)):
        cur = a[i] - b[i] - borrow
        if cur < 0:
            cur += 1 << LIMB_BITS
            borrow = 1
        else:
            borrow = 0
        a[i] = cur
    assert borrow == 0


def bignum_shl1(a):
    """Shift a whole limb array left by 1 bit, in place, dropping overflow bit
    beyond the array (caller must size the array with headroom)."""
    carry = 0
    for i in range(len(a)):
        new_carry = (a[i] >> (LIMB_BITS - 1)) & 1
        a[i] = ((a[i] << 1) | carry) & LIMB_MASK
        carry = new_carry
    return carry  # bit shifted out of the top


def bignum_get_bit(a, bit_index):
    limb = bit_index // LIMB_BITS
    off = bit_index % LIMB_BITS
    if limb >= len(a):
        return 0
    return (a[limb] >> off) & 1


def bignum_mod(product, modulus_limbs, product_bits):
    """
    Binary long-division-style reduction: product mod modulus, where
    `product` is a limb array (little-endian) representing an integer with
    up to `product_bits` significant bits, and modulus_limbs is the
    fixed-width (NUM_LIMBS) modulus. Processes one bit of the product at a
    time, MSB first: remainder = remainder*2 + next_bit; if remainder >=
    modulus, remainder -= modulus. This never needs quotient-digit
    estimation (unlike Knuth Algorithm D) -- purely mechanical, which is
    exactly why it's the version being ported to MQL5: fewer places for a
    translation bug to hide.

    The remainder register is kept at NUM_LIMBS+1 limbs (one extra limb of
    headroom) because remainder*2+bit can transiently need one more bit
    than the modulus itself before the conditional subtraction brings it
    back under the modulus -- sizing it at exactly NUM_LIMBS overflows.
    """
    remainder = [0] * (NUM_LIMBS + 1)
    modulus_ext = list(modulus_limbs) + [0]
    for bit_index in reversed(range(product_bits)):
        carry = bignum_shl1(remainder)
        assert carry == 0, "even with headroom, overflow means product_bits/modulus width assumption is wrong"
        remainder[0] |= bignum_get_bit(product, bit_index)
        if bignum_cmp(remainder, modulus_ext) >= 0:
            bignum_sub_inplace(remainder, modulus_ext)
    return remainder[:NUM_LIMBS]


def bignum_mulmod(a_limbs, b_limbs, modulus_limbs):
    product = bignum_mul(a_limbs, b_limbs)
    return bignum_mod(product, modulus_limbs, 2 * NUM_LIMBS * LIMB_BITS)


def bignum_modexp(base_limbs, exponent: int, modulus_limbs):
    """Right-to-left square-and-multiply. exponent is a plain Python int
    (in the real MQL5 port, e is fixed at 65537 -- a compile-time constant,
    never read from untrusted input, so this is fine to keep simple)."""
    result = [0] * NUM_LIMBS
    result[0] = 1  # big-int 1
    base = list(base_limbs)
    e = exponent
    while e > 0:
        if e & 1:
            result = bignum_mulmod(result, base, modulus_limbs)
        base = bignum_mulmod(base, base, modulus_limbs)
        e >>= 1
    return result


def verify_pkcs1v15_sha256(message: bytes, signature: bytes, n: int, e: int) -> bool:
    n_limbs = to_limbs(n)
    sig_limbs = to_limbs(int.from_bytes(signature, "big"))
    m_limbs = bignum_modexp(sig_limbs, e, n_limbs)
    m_int = from_limbs(m_limbs)
    k = (n.bit_length() + 7) // 8  # modulus byte length, 256 for RSA-2048
    encoded = m_int.to_bytes(k, "big")

    digest = hashes.Hash(hashes.SHA256())
    digest.update(message)
    h = digest.finalize()

    expected_suffix = SHA256_DIGESTINFO_PREFIX + h
    pad_len = k - 3 - len(expected_suffix)
    if pad_len < 8:
        return False
    expected = b"\x00\x01" + (b"\xff" * pad_len) + b"\x00" + expected_suffix
    # constant-time-ish compare is nice-to-have; not a live remote timing
    # oracle scenario here (local file/lease verification), correctness
    # first for this prototype.
    return encoded == expected


def main():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_numbers = private_key.public_key().public_numbers()
    n, e = public_numbers.n, public_numbers.e
    print(f"n bit_length={n.bit_length()} e={e}")

    messages = [
        b"",
        b"abc",
        b"XAUCLOUD-LEASE|v1|lease_id=abc123|expires_at=2026-07-25T15:00:00Z",
        b"x" * 500,
    ]

    for msg in messages:
        signature = private_key.sign(msg, padding.PKCS1v15(), hashes.SHA256())
        ok = verify_pkcs1v15_sha256(msg, signature, n, e)
        print(f"message len={len(msg):4d}  valid-signature verify -> {ok}")
        assert ok, "REAL signature failed to verify -- algorithm bug"

        # negative: tampered message
        tampered_msg = msg + b"X"
        ok_tampered_msg = verify_pkcs1v15_sha256(tampered_msg, signature, n, e)
        assert not ok_tampered_msg, "tampered message incorrectly verified!"

        # negative: tampered signature (flip one bit)
        sig_bytes = bytearray(signature)
        sig_bytes[-1] ^= 0x01
        ok_tampered_sig = verify_pkcs1v15_sha256(msg, bytes(sig_bytes), n, e)
        assert not ok_tampered_sig, "tampered signature incorrectly verified!"

        # negative: wrong public key
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        other_n = other_key.public_key().public_numbers().n
        ok_wrong_key = verify_pkcs1v15_sha256(msg, signature, other_n, e)
        assert not ok_wrong_key, "signature incorrectly verified under wrong public key!"

        print(f"  tampered message -> {ok_tampered_msg}, tampered signature -> {ok_tampered_sig}, wrong key -> {ok_wrong_key}")

    print("\nALL PROTOTYPE CHECKS PASSED (valid + 3 negative cases x 4 messages)")


if __name__ == "__main__":
    main()
