"""Comprehensive safety, precision, and recall audit for Devanagari Search Normalization."""

import pytest
from src.postprocessor import DevanagariSearchNormalizer, NORMALIZER_VERSION


# ==============================================================================
# 1. Independent Transformation Tests
# ==============================================================================
def test_normalizer_version():
    """Verify normalizer records a semantic version for search index invalidation."""
    assert NORMALIZER_VERSION == "1.0.0"
    assert DevanagariSearchNormalizer.VERSION == "1.0.0"


def test_independent_unicode_normalization():
    """Verify NFC canonical composition without modifying semantic content."""
    # Decomposed Nukta (क + combining nukta U+093C) vs pre-composed Qa (U+0958)
    decomposed = "\u0915\u093C"
    precomposed = "\u0958"
    assert decomposed != precomposed
    # In Unicode standard, Devanagari nukta pre-composed characters are Composition Exclusions;
    # NFC normalizes both to the canonical decomposed form (U+0915 + U+093C).
    norm_decomp = DevanagariSearchNormalizer.normalize_unicode(decomposed, "NFC")
    norm_precomp = DevanagariSearchNormalizer.normalize_unicode(precomposed, "NFC")
    assert norm_decomp == norm_precomp == decomposed


def test_independent_strip_invisible_format_chars():
    """Verify ZWJ and ZWNJ removal prevents hidden indexing mismatches."""
    zwj_text = "क्\u200Dष"
    zwnj_text = "क्\u200Cत"
    normal = "क्ष"
    normal_kt = "क्त"

    assert DevanagariSearchNormalizer.strip_invisible_format_chars(zwj_text) == normal
    assert DevanagariSearchNormalizer.strip_invisible_format_chars(zwnj_text) == normal_kt


def test_independent_normalize_punctuation():
    """Verify OCR punctuation artifacts are normalized to standard Devanagari signs."""
    # Pipe to Danda
    assert DevanagariSearchNormalizer.normalize_punctuation("सत्यमेव जयते |") == "सत्यमेव जयते । "
    # Double pipe to Double Danda
    assert DevanagariSearchNormalizer.normalize_punctuation("ॐ शान्तिः ||") == "ॐ शान्तिः ॥"
    # ASCII colon after Sanskrit word to Visarga
    assert DevanagariSearchNormalizer.normalize_punctuation("हरि:") == "हरिः"
    # Standard English colon is NOT altered
    assert DevanagariSearchNormalizer.normalize_punctuation("Chapter 1: Introduction") == "Chapter 1: Introduction"


def test_independent_chandrabindu():
    """Verify Chandrabindu converts to Anusvara for search index equivalence."""
    assert DevanagariSearchNormalizer.normalize_chandrabindu("गाँव") == "गांव"
    assert DevanagariSearchNormalizer.normalize_chandrabindu("हँसना") == "हंसना"
    assert DevanagariSearchNormalizer.normalize_chandrabindu("चाँद") == "चांद"


def test_independent_pancham_varna_canonicalization():
    """Verify Pancham Varna stops convert to homorganic Anusvara."""
    # ङ -> k-varga
    assert DevanagariSearchNormalizer.canonicalize_pancham_varna("सङ्कल्प") == "संकल्प"
    assert DevanagariSearchNormalizer.canonicalize_pancham_varna("गङ्गा") == "गंगा"
    # ञ -> ch-varga
    assert DevanagariSearchNormalizer.canonicalize_pancham_varna("चञ्चल") == "चंचल"
    # ण -> t-varga retroflex
    assert DevanagariSearchNormalizer.canonicalize_pancham_varna("कण्ठ") == "कंठ"
    # न -> t-varga dental
    assert DevanagariSearchNormalizer.canonicalize_pancham_varna("सन्त") == "संत"
    assert DevanagariSearchNormalizer.canonicalize_pancham_varna("अन्तर") == "अंतर"
    # म -> p-varga labial
    assert DevanagariSearchNormalizer.canonicalize_pancham_varna("सम्बन्ध") == "संबंध"


def test_independent_nukta_canonicalization_vs_stripping():
    """Verify default (strip_nukta=False) preserves meaning, while strip_nukta=True collapses."""
    nfc_decomposed = "\u0915\u093Cलम"  # क़लम decomposed
    nfc_precomposed = "क़लम"          # क़लम precomposed

    # 1. Default (strip_nuktas=False): Preserves nukta canonically
    tok_decomp = DevanagariSearchNormalizer.to_search_tokens(nfc_decomposed, strip_nuktas=False)
    tok_precomp = DevanagariSearchNormalizer.to_search_tokens(nfc_precomposed, strip_nuktas=False)
    assert tok_decomp == tok_precomp == ["क़लम"]

    # Semantic pairs MUST NOT collide by default!
    raj_hindi = "राज"   # kingdom
    raz_urdu = "राज़"    # secret
    assert DevanagariSearchNormalizer.to_search_tokens(raj_hindi, strip_nuktas=False) != \
           DevanagariSearchNormalizer.to_search_tokens(raz_urdu, strip_nuktas=False)

    # 2. Opt-in fuzzy (strip_nuktas=True): Collapses both to base characters
    assert DevanagariSearchNormalizer.to_search_tokens(raj_hindi, strip_nuktas=True) == \
           DevanagariSearchNormalizer.to_search_tokens(raz_urdu, strip_nuktas=True) == ["राज"]


# ==============================================================================
# 2. Precision and Recall Audit: Positive & Negative Evaluation
# ==============================================================================

# Positive Set: Valid spelling variants that MUST match (Target: 100% Recall)
POSITIVE_SPELLING_PAIRS = [
    ("सम्बन्ध", "संबंध", "Pancham varga Ma vs Anusvara"),
    ("सङ्कल्प", "संकल्प", "Pancham varga Nga vs Anusvara"),
    ("गाँव", "गांव", "Chandrabindu vs Anusvara"),
    ("अन्तर्राष्ट्रीय", "अंतर्राष्ट्रीय", "Pancham varga Na vs Anusvara"),
    ("क्\u200Dष", "क्ष", "ZWJ half-form ligature"),
    ("राम गया |", "राम गया ।", "Pipe vs Purna Virama"),
    ("ॐ शान्तिः ||", "ॐ शान्तिः ॥", "Double Pipe vs Double Danda"),
    ("नम:", "नमः", "ASCII colon vs Visarga"),
    ("गङ्गा", "गंगा", "Nga ligature vs Anusvara"),
    ("हँसना", "हंसना", "Chandrabindu vs Anusvara"),
]

# Negative Set: Distinct semantic words that MUST NOT collide (Target: 0% False Positives)
NEGATIVE_DISTINCT_PAIRS = [
    ("राज", "राज़", "Kingdom vs Secret (Nukta contrast)"),
    ("जरा", "ज़रा", "Old age vs A little bit (Nukta contrast)"),
    ("खाना", "ख़ाना", "Food vs Drawer/Compartment (Nukta contrast)"),
    ("बाग", "बाग़", "Reins vs Garden (Nukta contrast)"),
    ("फन", "फ़न", "Snake hood vs Art/Skill (Nukta contrast)"),
    ("कवि", "कपि", "Poet vs Monkey"),
    ("ग्रह", "गृह", "Planet vs Home"),
    ("प्रसाद", "प्रासाद", "Grace/Offering vs Palace"),
    ("कर्म", "क्रम", "Action vs Order/Sequence"),
    ("दिशा", "दशा", "Direction vs State/Condition"),
]


def test_positive_pairs_match_under_normalization():
    """Verify that all genuine spelling variants successfully match under normalizer."""
    normalizer = DevanagariSearchNormalizer
    true_positives = 0
    total = len(POSITIVE_SPELLING_PAIRS)

    for word_a, word_b, desc in POSITIVE_SPELLING_PAIRS:
        tok_a = normalizer.to_search_tokens(word_a, strip_nuktas=False)
        tok_b = normalizer.to_search_tokens(word_b, strip_nuktas=False)
        matches = (tok_a == tok_b)
        if matches:
            true_positives += 1
        assert matches, f"Failed positive match: '{word_a}' vs '{word_b}' ({desc})"

    recall = (true_positives / total) * 100.0
    assert recall == 100.0, f"Expected 100% recall on positive pairs, got {recall:.2f}%"


def test_negative_pairs_do_not_collide_under_safe_normalization():
    """Verify that distinct semantic words do NOT collide under default normalizer."""
    normalizer = DevanagariSearchNormalizer
    false_positives = 0
    total = len(NEGATIVE_DISTINCT_PAIRS)

    for word_a, word_b, desc in NEGATIVE_DISTINCT_PAIRS:
        tok_a = normalizer.to_search_tokens(word_a, strip_nuktas=False)
        tok_b = normalizer.to_search_tokens(word_b, strip_nuktas=False)
        collision = (tok_a == tok_b)
        if collision:
            false_positives += 1
        assert not collision, f"Forbidden false collision: '{word_a}' collided with '{word_b}' ({desc})"

    fpr = (false_positives / total) * 100.0
    assert fpr == 0.0, f"Expected 0% false positive rate on distinct semantic pairs, got {fpr:.2f}%"


def test_audit_precision_and_recall_metric_calculation():
    """Compute and verify complete classification metrics (Precision, Recall, F1)."""
    normalizer = DevanagariSearchNormalizer

    # Run positive tests
    tp = sum(
        1 for a, b, _ in POSITIVE_SPELLING_PAIRS
        if normalizer.to_search_tokens(a, strip_nuktas=False) == normalizer.to_search_tokens(b, strip_nuktas=False)
    )
    fn = len(POSITIVE_SPELLING_PAIRS) - tp

    # Run negative tests
    fp = sum(
        1 for a, b, _ in NEGATIVE_DISTINCT_PAIRS
        if normalizer.to_search_tokens(a, strip_nuktas=False) == normalizer.to_search_tokens(b, strip_nuktas=False)
    )
    tn = len(NEGATIVE_DISTINCT_PAIRS) - fp

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    assert precision == 1.0, f"Precision degraded: {precision}"
    assert recall == 1.0, f"Recall degraded: {recall}"
    assert f1 == 1.0, f"F1 score degraded: {f1}"
    assert fpr == 0.0, f"False positive rate non-zero: {fpr}"
