import sys
import inspect
import tempfile
import pathlib
import traceback

sys.path.insert(0, "tests")
sys.path.insert(0, "scripts")
import test_replay_learning_harness as t  # noqa: E402

fns = [name for name in dir(t) if name.startswith("test_")]
passed = 0
failed = 0
for name in fns:
    fn = getattr(t, name)
    try:
        sig = inspect.signature(fn)
        if "tmp_path" in sig.parameters:
            with tempfile.TemporaryDirectory() as td:
                fn(pathlib.Path(td))
        else:
            fn()
        passed += 1
    except Exception as e:
        failed += 1
        print(f"FAIL: {name}: {e}")
        traceback.print_exc()
print(f"{passed} passed, {failed} failed out of {len(fns)}")
