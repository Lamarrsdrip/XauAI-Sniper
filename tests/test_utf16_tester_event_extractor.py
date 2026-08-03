import codecs
import tempfile
import unittest
from pathlib import Path

from scripts.extract_utf16_tester_events import detect_utf16, extract


class Utf16TesterEventExtractorTests(unittest.TestCase):
    def test_detects_bomless_big_endian_and_extracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "tail.log"
            output = Path(tmp) / "events.log"
            source.write_bytes("ignore\nGENERAL_10M_EXTENSION_DEADLINE x\n".encode("utf-16-be"))
            self.assertEqual(detect_utf16(source), "utf-16-be")
            self.assertEqual(extract(source, output, ["GENERAL_10M_EXTENSION"]), 1)
            self.assertIn("DEADLINE", output.read_text())

    def test_detects_little_endian_bom(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "agent.log"
            source.write_bytes(codecs.BOM_UTF16_LE + "TRADE-DIAG EXIT\n".encode("utf-16-le"))
            self.assertEqual(detect_utf16(source), "utf-16-le")

    def test_empty_extraction_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "agent.log"
            source.write_bytes("nothing\n".encode("utf-16-le"))
            with self.assertRaises(RuntimeError):
                extract(source, Path(tmp) / "out.log", ["missing"])


if __name__ == "__main__":
    unittest.main()
