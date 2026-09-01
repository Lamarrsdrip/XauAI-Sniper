//+------------------------------------------------------------------+
//| XauCloudLeaseCryptoTest.mq5                                       |
//|                                                                    |
//| Standalone MQL5 script self-test for XauCloudLeaseCrypto.mqh.    |
//| Test vectors below are REAL RSA-2048/SHA-256/PKCS#1v1.5 signatures|
//| produced by Python's `cryptography` library (the actual backend   |
//| signer implementation) -- generated once and hardcoded here so    |
//| this script has no network/file dependency. See                   |
//| audits/offline_lease/ for the generation script and the identical |
//| algorithm's Python-side cross-check.                               |
//|                                                                    |
//| Run: attach as a Script to any chart (View -> Scripts), or run    |
//| via MetaEditor's Script test runner. Output goes to the Experts/   |
//| Journal log -- look for "XAUCLOUD_LEASE_CRYPTO_TEST" lines and the|
//| final "ALL TESTS PASSED" / "TESTS FAILED" summary line.           |
//+------------------------------------------------------------------+
#property strict
#property script_show_inputs

#include "XauCloudLeaseCrypto.mqh"

string TEST_MODULUS_HEX = "c6eaf2b1a8cf95c6f161c8a6b5ac861f5046c6cd54dfc981be7d97897647d1ed2048eff4ceea1fdd7a615bc7868189c548844cb0941b8a258e278e357e10df778c142d0d7c00e4ffc6b28cbc47792594e6675b23018bceb96551ce4202ae9340cc237333b147a3e36345e182da3bf7bb59de954fe3fc4c75e595685533c4aac08a9110a98b070f66513314388e62df44b69cd9974e14907b8169d6d59cfe6d1cea8b9f4a96e4cd2caf21cd72c1dc3c5cdc8582c2a3433c103de6c2db76570312f383966dd6cf68775b268a277a58e0cb964680422f8449b4b0c1bae2e75a86c8e72ab8e4bf9a346bd8f2eeb9b3121d94b46e76f5318c2720da656f08368b6d7b";
string TEST_WRONG_MODULUS_HEX = "b5c113b7946b6ab5504fd17118d36eb57b3cbd3d3bb04478ad171ae3e4de6916d290944ca98ed72f9bb0a071bcbe352e41d8e695aaad7d541368417a0c72b19446f7a1ebcaaefa09a35530350e4ccff0243888aaa78b25ec809818c446689ceaefed0ba387b8002a2cbfba43b5b3fbf141719f431278a6490fe06e7dd9a41bc2844f86c7960fa36f66bde6174261b9b425a40f727460bda2444c8f92764782883a2d9fff7e4c8a7fd7ea557e2315da84bb324131ac72716b8d882d0f3a548a2ccc6984dc95085981d4ebb29a368de31334f8922d4922438c563a1dbc08e0571c930747e2511e88542745ca71b03f5c055cb1e086a44b5506dce58fd156e2d8b5";

int g_pass = 0;
int g_fail = 0;

void CheckTrue(string label, bool got, bool want)
{
   if(got == want)
   {
      g_pass++;
      PrintFormat("XAUCLOUD_LEASE_CRYPTO_TEST PASS | %s | expected=%s got=%s", label, (string)want, (string)got);
   }
   else
   {
      g_fail++;
      PrintFormat("XAUCLOUD_LEASE_CRYPTO_TEST FAIL | %s | expected=%s got=%s", label, (string)want, (string)got);
   }
}

void RunVector(string label, string messageHex, string signatureHex)
{
   uchar msgBytes[];
   if(messageHex == "")
   {
      ArrayResize(msgBytes, 0);
   }
   else
   {
      if(!XAU_HexToBytes(messageHex, msgBytes))
      {
         g_fail++;
         PrintFormat("XAUCLOUD_LEASE_CRYPTO_TEST FAIL | %s | could not parse message hex", label);
         return;
      }
   }

   // 1. Valid signature, correct key, correct algorithm id -> must verify true
   bool okValid = XAU_LeaseVerifySignature(msgBytes, signatureHex, TEST_MODULUS_HEX, XAU_LEASE_ALGORITHM_ID);
   CheckTrue(label + " valid-signature", okValid, true);

   // 2. Tampered message (append one byte) -> must verify false
   uchar tamperedMsg[];
   int n = ArraySize(msgBytes);
   ArrayResize(tamperedMsg, n + 1);
   for(int i = 0; i < n; i++) tamperedMsg[i] = msgBytes[i];
   tamperedMsg[n] = 0x58; // 'X'
   bool okTamperedMsg = XAU_LeaseVerifySignature(tamperedMsg, signatureHex, TEST_MODULUS_HEX, XAU_LEASE_ALGORITHM_ID);
   CheckTrue(label + " tampered-message-rejected", okTamperedMsg, false);

   // 3. Tampered signature (flip last hex nibble) -> must verify false
   string tamperedSig = signatureHex;
   int lastIdx = StringLen(tamperedSig) - 1;
   ushort lastChar = StringGetCharacter(tamperedSig, lastIdx);
   ushort newChar = (lastChar == '0') ? (ushort)'1' : (ushort)'0';
   tamperedSig = StringSubstr(tamperedSig, 0, lastIdx) + XAU_TestByteToString(newChar);
   bool okTamperedSig = XAU_LeaseVerifySignature(msgBytes, tamperedSig, TEST_MODULUS_HEX, XAU_LEASE_ALGORITHM_ID);
   CheckTrue(label + " tampered-signature-rejected", okTamperedSig, false);

   // 4. Wrong public key -> must verify false
   bool okWrongKey = XAU_LeaseVerifySignature(msgBytes, signatureHex, TEST_WRONG_MODULUS_HEX, XAU_LEASE_ALGORITHM_ID);
   CheckTrue(label + " wrong-key-rejected", okWrongKey, false);

   // 5. Unknown algorithm id -> must fail closed without even attempting crypto
   bool okUnknownAlg = XAU_LeaseVerifySignature(msgBytes, signatureHex, TEST_MODULUS_HEX, "SOME-OTHER-ALG-v9");
   CheckTrue(label + " unknown-algorithm-rejected", okUnknownAlg, false);
}

string XAU_TestByteToString(ushort c)
{
   uchar arr[1];
   arr[0] = (uchar)c;
   return CharArrayToString(arr, 0, 1);
}

void OnStart()
{
   Print("XAUCLOUD_LEASE_CRYPTO_TEST BEGIN");

   RunVector("empty-message", "", "b940ff601a8cfbc0823cf6e9b1f2560e93ad282d34374bd84bb6383d276514f0c36b22e035440313d02236338049ff92acda7c4f6fdc105a5558589f6d3b17b3948c4463688ba3605913bbd094e7d13d085c20683b43c9f0a0af5cd9421e264301b1b5b771d57d34cdcca8a1924259bd83e6f86d24a7b45aedfcbe555580cf3af619f83a3c746a3ec9d935ceaf8ccc357e66228b9a2db7d1a606a3e3e1f04db469a6882c461e8ea207103a5b511b0cb41a03fb83cf56acf2d2e1872499d05592e27b2fb4b380d5cbef1ca2ab799832ff27035758e610c880e8b748e083db1a5f09ffa91e160df13eb3ad00e88c5dacecd51f32f3e56bccfb7300000ffed6d999");

   RunVector("abc-message", "616263", "a7b7fd12b49b1f6208a064798ec62449249bdbf6851e02cddb7567a15d0fae1f0299ae5dac746a7411028e06704b9fa29886e955887bf0388a6247fada6ff9a0b05e44bb6cbbb8e1a438d4790d0d3b7484d1d7272c9b1ed7d110d8ae930013b493afa0f3d934fcc75c17f71880cdc457f42248aaf42b8bfa0cb38ac3fefde961098ba135aa902eb1e2cd8c9c6b35dd59455af275e819302787f1b3ff88022ead8de4dee66670b1751ae2baf9eda387a62434f98c1ad8e86aa5ed4411224187d0d3d26646eac197d5a9a1b58979b2276b7bcfdab4e7abe6a0f1683262fd8d75d00823c2cdbba28dd6aca907a543969e4d36d375da3cee21383c18093fb3dd40b3");

   RunVector("lease-like-message", "584155434c4f55442d4c454153457c76317c6c656173655f69643d6162633132337c657870697265735f61743d323032362d30372d32355431353a30303a30305a7c696e7374616c6c6174696f6e5f69643d4d41432d5052494d4152592d3031", "b12c441e6c20fc090b2ecfa82d0357b85bf9231909b62a23efb38895c05bc39bb4c574f7bd8b72484a8610757ad49b957adf1ebba5309be0edb13097e07812d66ebed05017afe024d5dec3757b79c3237d78ecbe20152ba01b4fe055007d5abd638a0a7b17d5c3f55fa7af5163fa94f309417c18825d14104bbada5d1d0b858a297c971bdaa4e0b419eb56d7b21ae258308b1c16742b13eef1298033f8238490a4bd2b21151dd4b7051b9fcd06d71b94e169fd3aec9154bebde4d1e51b68f15af33d583e2600fdf156f1cacaaae09b0c0ef6034926a650090a907e4d4e72e412fbd1b5ad063cd98d8e8fe8b28a381d5bdd4620642a840a0e1d21b6e3b6ffbc90");

   PrintFormat("XAUCLOUD_LEASE_CRYPTO_TEST SUMMARY pass=%d fail=%d", g_pass, g_fail);
   if(g_fail == 0)
      Print("XAUCLOUD_LEASE_CRYPTO_TEST ALL TESTS PASSED");
   else
      Print("XAUCLOUD_LEASE_CRYPTO_TEST TESTS FAILED");
}
