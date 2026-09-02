from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = ROOT / 'backend' / 'ea_code' / 'XauCloud-Fixed-B1-NoShadow-v6.28.2.mq5'

def test_no_ea_shadowml_runtime_hook_or_endpoint():
    text=CANDIDATE.read_text(encoding='utf-8', errors='ignore')
    assert 'XAUCloud-Fixed-B1-NoShadow_v6.28.2' in text
    assert 'XAU_ShadowMLRecordDecision(' not in text
    assert '"/api/ml/shadow/record"' not in text
    assert '#define XAU_TRADEBRAIN_LOCAL_ROWS_HAVE_AUTHORITY false' in text

def test_core_b1_order_and_m10_logic_preserved():
    text=CANDIDATE.read_text(encoding='utf-8', errors='ignore')
    assert 'XAU_IsPermanentM10CategoryBlocked' in text
    assert 'trade.Buy(lots, Symbol(), 0, sl, brokerTP, ownerDirectionComment)' in text
    assert 'trade.Sell(lots, Symbol(), 0, sl, brokerTP, ownerDirectionComment)' in text
