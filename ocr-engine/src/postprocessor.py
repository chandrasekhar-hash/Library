"""Devanagari and Multilingual Search Normalizer and Post-Processing Utilities.

Version: 1.0.0

Provides search-oriented normalization and token extraction for full-text search
indexing without altering the original raw OCR transcription.
"""

import re
import unicodedata
from typing import Dict, List, Set, Tuple, Any
from rapidfuzz.distance import Levenshtein

NORMALIZER_VERSION = "1.0.0"

# Common Devanagari Unicode codepoints
ANUSVARA = "\u0902"       # ं
CHANDRABINDU = "\u0901"   # ँ
VISARGA = "\u0903"        # ः
NUKTA = "\u093C"          # ़
VIRAMA = "\u094D"         # ् (Halant)
DANDA = "\u0964"          # ।
DOUBLE_DANDA = "\u0965"   # ॥
ZWJ = "\u200D"            # Zero-width joiner
ZWNJ = "\u200C"           # Zero-width non-joiner

# Devanagari Matras
MATRA_AA = "\u093E"       # ा
MATRA_I_SHORT = "\u093F"  # ि (Chhoti-i, pre-base glyph)
MATRA_I_LONG = "\u0940"   # ी
MATRA_U_SHORT = "\u0941"  # ु
MATRA_U_LONG = "\u0942"   # ू
MATRA_RI = "\u0943"       # ृ
MATRA_E = "\u0947"        # े
MATRA_AI = "\u0948"       # ै
MATRA_O = "\u094B"        # ो
MATRA_AU = "\u094C"       # ौ

# Pre-composed vs Decomposed Devanagari Nukta characters
NUKTA_DECOMPOSED_MAP = {
    "\u0958": "\u0915\u093C",  # क़ -> क + ़
    "\u0959": "\u0916\u093C",  # ख़ -> ख + ़
    "\u095A": "\u0917\u093C",  # ग़ -> ग + ़
    "\u095B": "\u091C\u093C",  # ज़ -> ज + ़
    "\u095C": "\u0921\u093C",  # ड़ -> ड + ़
    "\u095D": "\u0922\u093C",  # ढ़ -> ढ + ़
    "\u095E": "\u092B\u093C",  # फ़ -> फ + ़
    "\u095F": "\u092F\u093C",  # य़ -> य + ़
}

# Homorganic nasal groups for Pancham Varna / Anusvara normalization
NASAL_REPLACEMENTS = [
    (r"ङ्([कखगघ])", r"ं\1"),
    (r"ञ्([चछजझ])", r"ं\1"),
    (r"ण्([टठडढ])", r"ं\1"),
    (r"न्([तथदध])", r"ं\1"),
    (r"म्([पफबभ])", r"ं\1"),
]


class DevanagariSearchNormalizer:
    """
    Search-oriented Devanagari text normalizer (Version 1.0.0).

    Produces canonical search index tokens without altering original OCR output.
    Addresses the character-accuracy vs. word-accuracy gap for book full-text search.
    """

    VERSION = NORMALIZER_VERSION

    @staticmethod
    def normalize_unicode(text: str, form: str = "NFC") -> str:
        """Apply Unicode canonical composition (NFC) or decomposition (NFD)."""
        return unicodedata.normalize(form, text)

    @staticmethod
    def strip_invisible_format_chars(text: str) -> str:
        """Strip Zero-Width Joiner (ZWJ, U+200D) and Non-Joiner (ZWNJ, U+200C)."""
        return text.replace(ZWJ, "").replace(ZWNJ, "")

    @staticmethod
    def normalize_punctuation(text: str) -> str:
        """
        Normalize OCR punctuation artifacts to standard punctuation:
        - Pipe '|' or exclamation '!' used in place of Devanagari Danda '।'.
        - Double pipe '||' to Double Danda '॥'.
        - Latin colon ':' following Devanagari characters mapped to Visarga 'ः'.
        """
        # Replace double pipe / exclamation with double danda
        text = re.sub(r"[\|!]{2,}", DOUBLE_DANDA, text)
        # Replace standalone pipe or exclamation with single danda
        text = re.sub(r"\s+[\|!]\s*", " " + DANDA + " ", text)
        # Replace Latin colon immediately preceded by Devanagari character with Visarga
        text = re.sub(r"([\u0900-\u097F]):", r"\1" + VISARGA, text)
        return text

    @staticmethod
    def normalize_chandrabindu(text: str) -> str:
        """Convert Chandrabindu ('ँ', U+0901) to Anusvara ('ं', U+0902) for search equivalence."""
        return text.replace(CHANDRABINDU, ANUSVARA)

    @staticmethod
    def canonicalize_pancham_varna(text: str) -> str:
        """
        Normalize classical Pancham Varna conjuncts to Anusvara:
        e.g., 'सङ्कल्प' -> 'संकल्प', 'सम्बन्ध' -> 'संबंध', 'अन्तर' -> 'अंतर'.
        """
        normalized = text
        for pattern, replacement in NASAL_REPLACEMENTS:
            normalized = re.sub(pattern, replacement, normalized)
        return normalized

    @classmethod
    def normalize_nasals_and_bindus(cls, text: str) -> str:
        """Apply both Chandrabindu and Pancham Varna normalization."""
        text = cls.normalize_chandrabindu(text)
        return cls.canonicalize_pancham_varna(text)

    @staticmethod
    def normalize_nuktas(text: str, strip_nukta: bool = False) -> str:
        """
        Standardize nuktas:
        - When strip_nukta=False (DEFAULT): Canonicalizes via NFC composition.
          Pre-composed and decomposed forms (e.g. क़ and क+़) become identical without
          collapsing distinct words like राज (kingdom) and राज़ (secret).
        - When strip_nukta=True (OPT-IN FUZZY): Strips nuktas to collapse क़->क, फ़->फ.
          Caution: increases false positive rate on semantic minimal pairs.
        """
        text = unicodedata.normalize("NFC", text)
        if strip_nukta:
            text = text.replace(NUKTA, "")
            for precomp, decomp in NUKTA_DECOMPOSED_MAP.items():
                base_char = decomp[0]
                text = text.replace(precomp, base_char)
        return text

    @classmethod
    def to_search_tokens(cls, text: str, strip_nuktas: bool = False) -> List[str]:
        """
        Generate search tokens optimized for indexing and retrieval:
        1. Unicode NFC normalization.
        2. Strip ZWJ / ZWNJ formatting codes.
        3. Punctuation cleanup (dandas, colons to visargas).
        4. Nasal / Anusvara canonicalization (Pancham Varna & Chandrabindu).
        5. Nukta canonicalization (defaults to strip_nuktas=False to preserve word meaning).
        6. Whitespace and non-alphanumeric tokenization.
        """
        t = cls.normalize_unicode(text, "NFC")
        t = cls.strip_invisible_format_chars(t)
        t = cls.normalize_punctuation(t)
        t = cls.normalize_nasals_and_bindus(t)
        t = cls.normalize_nuktas(t, strip_nukta=strip_nuktas)

        # Remove dandas, punctuation, and split into tokens
        t = re.sub(r"[\.,;:!\?\"\'\(\)\[\]\{\}—–\-।॥]", " ", t)
        tokens = [tok.strip() for tok in t.split() if tok.strip()]
        return tokens

    @classmethod
    def analyze_matra_preservation(cls, reference: str, hypothesis: str) -> Dict[str, Any]:
        """
        Analyze specific matra losses and corruptions between reference and hypothesis text.
        Particularly audits the left-attaching 'chhoti-i' matra (ि, U+093F).
        """
        matras = {
            "chhoti_i": (MATRA_I_SHORT, "ि (Chhoti-i)"),
            "badi_i": (MATRA_I_LONG, "ी (Badi-i)"),
            "chhota_u": (MATRA_U_SHORT, "ु (Chhota-u)"),
            "bada_u": (MATRA_U_LONG, "ू (Bada-u)"),
            "aa": (MATRA_AA, "ा (Aa)"),
            "e": (MATRA_E, "े (E)"),
            "ai": (MATRA_AI, "ै (Ai)"),
            "o": (MATRA_O, "ो (O)"),
            "au": (MATRA_AU, "ौ (Au)"),
            "ri": (MATRA_RI, "ृ (Ri)"),
            "anusvara": (ANUSVARA, "ं (Anusvara)"),
            "visarga": (VISARGA, "ः (Visarga)"),
            "virama": (VIRAMA, "् (Halant/Virama)"),
        }

        results = {}
        for key, (glyph, label) in matras.items():
            ref_count = reference.count(glyph)
            hyp_count = hypothesis.count(glyph)
            diff = hyp_count - ref_count
            results[key] = {
                "label": label,
                "reference_occurrences": ref_count,
                "hypothesis_occurrences": hyp_count,
                "delta": diff,
                "preservation_rate_pct": (
                    round(min(1.0, hyp_count / ref_count) * 100.0, 2)
                    if ref_count > 0
                    else 100.0
                ),
            }

        return results


def evaluate_raw_vs_normalized(
    reference: str, hypothesis: str, strip_nuktas: bool = False
) -> Dict[str, Any]:
    """
    Compare accuracy across three levels:
    1. Raw OCR output vs Raw Ground Truth.
    2. Unicode NFC Normalized output vs NFC Ground Truth.
    3. Search-Normalized Tokens vs Search-Normalized Ground Truth.
    Exposes the exact quantitative gap between transcription accuracy and searchability.
    """
    normalizer = DevanagariSearchNormalizer

    # 1. Raw Comparison
    ref_raw_clean = " ".join([l.strip() for l in reference.splitlines() if l.strip()])
    hyp_raw_clean = " ".join([l.strip() for l in hypothesis.splitlines() if l.strip()])

    raw_char_dist = Levenshtein.distance(ref_raw_clean, hyp_raw_clean)
    raw_cer = raw_char_dist / max(1, len(ref_raw_clean))
    ref_words_raw = ref_raw_clean.split()
    hyp_words_raw = hyp_raw_clean.split()
    raw_word_dist = Levenshtein.distance(ref_words_raw, hyp_words_raw)
    raw_wer = raw_word_dist / max(1, len(ref_words_raw))

    # 2. NFC Normalized Comparison
    ref_nfc = normalizer.normalize_unicode(ref_raw_clean, "NFC")
    hyp_nfc = normalizer.normalize_unicode(hyp_raw_clean, "NFC")

    nfc_char_dist = Levenshtein.distance(ref_nfc, hyp_nfc)
    nfc_cer = nfc_char_dist / max(1, len(ref_nfc))
    ref_words_nfc = ref_nfc.split()
    hyp_words_nfc = hyp_nfc.split()
    nfc_word_dist = Levenshtein.distance(ref_words_nfc, hyp_words_nfc)
    nfc_wer = nfc_word_dist / max(1, len(ref_words_nfc))

    # 3. Search-Normalized Tokens Comparison
    ref_search_tokens = normalizer.to_search_tokens(ref_raw_clean, strip_nuktas=strip_nuktas)
    hyp_search_tokens = normalizer.to_search_tokens(hyp_raw_clean, strip_nuktas=strip_nuktas)

    ref_search_str = " ".join(ref_search_tokens)
    hyp_search_str = " ".join(hyp_search_tokens)

    search_char_dist = Levenshtein.distance(ref_search_str, hyp_search_str)
    search_cer = search_char_dist / max(1, len(ref_search_str))
    search_word_dist = Levenshtein.distance(ref_search_tokens, hyp_search_tokens)
    search_wer = search_word_dist / max(1, len(ref_search_tokens))

    # Matra audit
    matra_audit = normalizer.analyze_matra_preservation(ref_raw_clean, hyp_raw_clean)

    return {
        "raw": {
            "cer": round(raw_cer, 4),
            "char_accuracy_pct": round(max(0.0, 1.0 - raw_cer) * 100.0, 2),
            "wer": round(raw_wer, 4),
            "word_accuracy_pct": round(max(0.0, 1.0 - raw_wer) * 100.0, 2),
            "ref_char_count": len(ref_raw_clean),
            "hyp_char_count": len(hyp_raw_clean),
            "ref_word_count": len(ref_words_raw),
            "hyp_word_count": len(hyp_words_raw),
        },
        "nfc": {
            "cer": round(nfc_cer, 4),
            "char_accuracy_pct": round(max(0.0, 1.0 - nfc_cer) * 100.0, 2),
            "wer": round(nfc_wer, 4),
            "word_accuracy_pct": round(max(0.0, 1.0 - nfc_wer) * 100.0, 2),
        },
        "search_tokens": {
            "cer": round(search_cer, 4),
            "search_char_accuracy_pct": round(max(0.0, 1.0 - search_cer) * 100.0, 2),
            "wer": round(search_wer, 4),
            "search_word_accuracy_pct": round(max(0.0, 1.0 - search_wer) * 100.0, 2),
            "ref_token_count": len(ref_search_tokens),
            "hyp_token_count": len(hyp_search_tokens),
            "word_accuracy_improvement_pct": round(
                (max(0.0, 1.0 - search_wer) - max(0.0, 1.0 - raw_wer)) * 100.0, 2
            ),
            "strip_nuktas": strip_nuktas,
        },
        "matra_preservation": matra_audit,
    }
