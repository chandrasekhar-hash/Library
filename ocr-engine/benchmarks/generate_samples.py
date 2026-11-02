"""Generate benchmark sample PDFs for Phase OCR-2.1 performance and reliability audit."""

import os
import json
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SAMPLES_DIR = Path(__file__).resolve().parent / "samples"
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

FONT_EN = "/System/Library/Fonts/Supplemental/Times New Roman.ttf"
FONT_DEVA = "/System/Library/Fonts/Supplemental/DevanagariMT.ttc"

PAGE_WIDTH = 2480
PAGE_HEIGHT = 3508


def create_base_canvas(bg_color=(255, 255, 255)):
    return Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), color=bg_color)


# ==============================================================================
# 1. One English Page
# ==============================================================================
def generate_01_english_1p():
    img = create_base_canvas()
    draw = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(FONT_EN, 72)
    body_font = ImageFont.truetype(FONT_EN, 48)

    title = "OF BOOKS AND LIBRARIES"
    lines = [
        "All books are divisible into two classes: the books of the hour, and the books of all time.",
        "The good book of the hour is simply the useful or pleasant talk of some person with whom",
        "you cannot otherwise converse, printed for you. Very useful often, telling you what you",
        "need to know; very pleasant often, as a friend's talk; but of its dignity never to be",
        "mistaken for a true book.",
        "",
        "A book of all time is written not merely to multiply the voice of the writer, but to",
        "perpetuate it. The author has something to say which he perceives to be true and useful,",
        "or helpfully beautiful. So far as he knows, no one has yet said it; so far as he knows,",
        "no one else can say it. He has something to state distinctly and musically;",
        "he would fain set it down forever, engrave it on rock, if he could.",
        "",
        "Libraries are not made; they grow. A great library contains the diary of the human race.",
        "The sanctuary of books preserves the memory of human thoughts and passions.",
        "Here every volume waits patiently upon the quiet shelf for the seeking reader."
    ]

    draw.text((250, 300), title, font=title_font, fill=(0, 0, 0))
    draw.line((250, 400, 2230, 400), fill=(0, 0, 0), width=4)

    y = 520
    for line in lines:
        if line:
            draw.text((250, y), line, font=body_font, fill=(0, 0, 0))
        y += 85

    pdf_path = SAMPLES_DIR / "01_english_1p.pdf"
    img.save(pdf_path, "PDF", resolution=300.0)

    return str(pdf_path), {
        "title": title,
        "body_lines": [l for l in lines if l],
        "language": "en",
        "page_count": 1,
        "description": "Single clean printed English page at 300 DPI",
    }


# ==============================================================================
# 2. Ten English Pages
# ==============================================================================
def generate_02_english_10p():
    pages = []
    manifest_pages = []

    title_font = ImageFont.truetype(FONT_EN, 70)
    body_font = ImageFont.truetype(FONT_EN, 48)

    sample_texts = [
        ("CHAPTER I: THE ARCHITECTURE OF KNOWLEDGE", [
            "The architecture of human knowledge has evolved through millennia of written records.",
            "From Mesopotamian cuneiform tablets to Alexandrian papyrus rolls, civilization endures.",
            "Each generation stands upon the intellectual foundations established by preceding thinkers.",
            "Without persistent textual preservation, scientific and cultural progress would reset.",
            "The library stands as humanity's collective external memory and enduring citadel."
        ]),
        ("CHAPTER II: THE CRAFT OF READING", [
            "Reading is not a passive reception of symbols, but an active dialogical engagement.",
            "To comprehend profound literature demands disciplined focus and reflective stillness.",
            "In our contemporary age of rapid digital distraction, deep sustained reading is endangered.",
            "Yet contemplation within a quiet sanctuary restores cognitive depth and inner equilibrium.",
            "A well-read mind navigates uncertainty with historical perspective and calm reason."
        ]),
        ("CHAPTER III: PRESERVATION AND DECAY", [
            "The physical longevity of literature is fraught with organic vulnerability.",
            "Acidic wood-pulp papers introduced in the nineteenth century deteriorate with alarming speed.",
            "Modern conservation techniques combine chemical deacidification with precision digitization.",
            "Digital facsimiles safeguard vulnerable originals while enabling global accessibility.",
            "Preservation is a solemn pact made between contemporary curators and posterity."
        ]),
        ("CHAPTER IV: PHILOSOPHY OF LANGUAGE", [
            "Language is the instrument through which abstract concepts achieve tangible definition.",
            "Words do not merely describe preexisting realities; they structure our perception.",
            "Syntax provides the architectural scaffolding for rational deduction and nuanced debate.",
            "When vocabularies diminish, the resolution of political and moral discourse declines.",
            "Vibrant literature continually renews and enriches the linguistic commons."
        ]),
        ("CHAPTER V: THE PRINTING REVOLUTION", [
            "Gutenberg's movable metal type dismantled the monopolistic scribe guilds of Europe.",
            "Standardized typography accelerated the dissemination of scientific treatises and translations.",
            "Universal literacy transformed political structures from feudal hierarchies to republics.",
            "The democratized press proved that ideas possess greater potency than standing armies.",
            "Information democratization remains the foundational pillar of modern civic freedom."
        ]),
        ("CHAPTER VI: THE SANCTUARY ENVIRONMENT", [
            "A quiet sanctuary provides shelter from the relentless clamor of modern urban life.",
            "Natural ambient illumination and muted acoustic design promote sustained mental flow.",
            "Surrounded by leather bindings and archival paper, one feels anchored across centuries.",
            "Here, reflection replaces reaction, and deliberate thought overcomes fleeting impulse.",
            "Sanctuaries are indispensable public spaces for creative and intellectual renewal."
        ]),
        ("CHAPTER VII: THE HISTORY OF SCHOLARSHIP", [
            "Rigorous scholarship demands patient collation, textual criticism, and verification.",
            "Medieval monastic scriptoria meticulously copied Classical texts across the Dark Ages.",
            "Renaissance humanists rediscovered lost manuscripts in forgotten monastic libraries.",
            "Critical editions compare variant readings to reconstruct archetypal master texts.",
            "Every cited footnote represents a brick in the fortress of verifiable truth."
        ]),
        ("CHAPTER VIII: POETRY AND TRANSLATION", [
            "Poetry compresses complex emotional insights into memorable rhythmic expressions.",
            "Translation is both a perilous art and a necessary bridge across cultural chasms.",
            "To translate is to negotiate between faithful fidelity and vibrant creative recreation.",
            "Master translators transplant foreign masterworks into fertile domestic soil.",
            "Through sympathetic translation, humanity discovers its shared universal yearnings."
        ]),
        ("CHAPTER IX: THE SCIENCE OF BOOKBINDING", [
            "Traditional bookbinding synthesizes tensile mechanics with aesthetic craftsmanship.",
            "Folded signatures sewn onto hemp cords provide lasting structural flexibility.",
            "Archival glue and hand-tooled leather spines resist centuries of physical wear.",
            "A thoughtfully bound volume opens flat without straining its delicate paper hinge.",
            "Material integrity ensures that human thoughts outlast the hands that crafted them."
        ]),
        ("CHAPTER X: THE DIGITAL HORIZON", [
            "Modern digital repositories archive petabytes of scanned literature and cultural metadata.",
            "Intelligent optical character recognition transforms inert pixel scans into searchable text.",
            "Vector embeddings and neural indexes unlock conceptual relationships across vast corpora.",
            "Yet digital convenience complements rather than replaces the tactile intimacy of physical books.",
            "The sanctuary of Aks bridges timeless reading tranquility with private local intelligence."
        ]),
    ]

    for i, (title, lines) in enumerate(sample_texts):
        img = create_base_canvas()
        draw = ImageDraw.Draw(img)

        draw.text((250, 320), title, font=title_font, fill=(0, 0, 0))
        draw.line((250, 440, 2230, 440), fill=(0, 0, 0), width=4)

        y = 560
        for line in lines:
            draw.text((250, y), line, font=body_font, fill=(0, 0, 0))
            y += 120

        # Footer page number
        draw.text((PAGE_WIDTH // 2 - 50, PAGE_HEIGHT - 300), f"— {i + 1} —", font=body_font, fill=(80, 80, 80))

        pages.append(img)
        manifest_pages.append({
            "page_number": i + 1,
            "title": title,
            "body_lines": lines,
        })

    pdf_path = SAMPLES_DIR / "02_english_10p.pdf"
    pages[0].save(pdf_path, "PDF", resolution=300.0, save_all=True, append_images=pages[1:])

    return str(pdf_path), {
        "language": "en",
        "page_count": 10,
        "description": "Multi-page English document (10 distinct literary chapters) at 300 DPI",
        "pages": manifest_pages,
    }


# ==============================================================================
# 3. One Hindi Page
# ==============================================================================
def generate_03_hindi_1p():
    img = create_base_canvas()
    draw = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(FONT_DEVA, 70)
    body_font = ImageFont.truetype(FONT_DEVA, 52)

    title = "साहित्य और पुस्तकालय का महत्व"
    lines = [
        "भारतीय साहित्य और संस्कृति में ज्ञान तथा विद्या का सर्वोच्च स्थान रहा है।",
        "प्रकृति, पर्यावरण और समस्त प्राणियों के संरक्षण से ही जीवन समृद्ध होता है।",
        "पुस्तकालय विचारों, सिद्धांतों और मानवीय अनुभवों का एक अमूल्य तीर्थस्थल है।",
        "सत्य, अहिंसा, न्याय और बंधुत्व किसी भी सभ्य समाज के मुख्य आधार स्तंभ हैं।",
        "अज्ञान के अंधकार को समाप्त करके चेतना को जागृत करना ही शिक्षा का मुख्य उद्देश्य है।",
        "कठिन परिस्थितियों में भी धैर्य और आत्मविश्वास बनाए रखना सफलता की कुंजी है।",
        "उत्कृष्ट पुस्तकें मनुष्य की सबसे सच्ची और निष्ठावान मार्गदर्शक होती हैं।"
    ]

    draw.text((250, 320), title, font=title_font, fill=(0, 0, 0))
    draw.line((250, 440, 2230, 440), fill=(0, 0, 0), width=4)

    y = 560
    for line in lines:
        draw.text((250, y), line, font=body_font, fill=(0, 0, 0))
        y += 120

    pdf_path = SAMPLES_DIR / "03_hindi_1p.pdf"
    img.save(pdf_path, "PDF", resolution=300.0)

    return str(pdf_path), {
        "title": title,
        "body_lines": lines,
        "language": "hi",
        "page_count": 1,
        "description": "Single printed Hindi page with complex conjuncts (प्र, क्त, स्त, र्ध, क्ष, ज्ञ) and matras",
    }


# ==============================================================================
# 4. Ten Hindi Pages
# ==============================================================================
def generate_04_hindi_10p():
    pages = []
    manifest_pages = []

    title_font = ImageFont.truetype(FONT_DEVA, 70)
    body_font = ImageFont.truetype(FONT_DEVA, 52)

    sample_hindi_chapters = [
        ("अध्याय १: भारतीय ज्ञान परंपरा", [
            "भारतीय ज्ञान परंपरा विश्व की प्राचीनतम और अत्यंत समृद्ध बौद्धिक परंपराओं में से एक है।",
            "ऋषियों और दार्शनिकों ने सत्य, चेतना और ब्रह्मांड के गूढ़ रहस्यों पर गहन चिंतन किया।",
            "उपनिषदों का मूल संदेश मनुष्य को अविद्या से मुक्त करके आत्मज्ञान की ओर अग्रसर करना है।",
            "ज्ञान केवल बौद्धिक विलास नहीं, बल्कि जीवन को श्रेष्ठ और नैतिक बनाने का साधन है।"
        ]),
        ("अध्याय २: भाषा और संस्कृति का संबंध", [
            "भाषा केवल संवाद का माध्यम नहीं, बल्कि संस्कृति और अस्मिता की संवाहिका होती है।",
            "देवनागरी लिपि की वैज्ञानिक बनावट और ध्वन्यात्मक शुद्धता विश्व में अद्वितीय है।",
            "जब कोई भाषा समृद्ध होती है, तो उसके साथ पूरे समाज की विचारशीलता उन्नत होती है।",
            "मातृभाषा में शिक्षा प्राप्त करने से मौलिक चिंतन और सृजनात्मकता का स्वाभाविक विकास होता है।"
        ]),
        ("अध्याय ३: पर्यावरण और भारतीय दृष्टिकोण", [
            "प्राचीन भारतीय मनीषियों ने प्रकृति को ईश्वर का सजीव रूप मानकर उसका वंदन किया।",
            "नदियों, पर्वतों और वनस्पतियों के प्रति कृतज्ञता की भावना हमारे संस्कारों में निहित है।",
            "प्रकृति का दोहन नहीं, बल्कि उसके साथ सामंजस्यपूर्ण सहअस्तित्व ही टिकाऊ विकास का आधार है।",
            "पर्यावरण की सुरक्षा वर्तमान समय की सबसे बड़ी नैतिक और मानवीय जिम्मेदारी है।"
        ]),
        ("अध्याय ४: स्वाध्याय और आत्मचिंतन", [
            "स्वाध्याय मनुष्य की अंतःचेतना को परिष्कृत और एकाग्र करने की दिव्य औषधि है।",
            "सत्संग और श्रेष्ठ ग्रंथों का अध्ययन मन के विकारों को दूर करके शांति प्रदान करता है।",
            "दैनिक जीवन में कुछ समय एकांत में बैठकर आत्मपरीक्षण करना मानसिक स्वास्थ्य के लिए आवश्यक है।",
            "जो व्यक्ति स्वयं को जान लेता है, उसके लिए संसार का कोई भी संकट कठिन नहीं रहता।"
        ]),
        ("अध्याय ५: कला, संगीत और सौंदर्यबोध", [
            "भारतीय ललित कलाओं का उद्देश्य मानवीय संवेदनाओं को उदात्त और पवित्र बनाना रहा है।",
            "शास्त्रीय संगीत की प्रत्येक रागिनी मन को शांति, करुणा और भक्ति रस में डुबो देती है।",
            "शिल्प, चित्रकला और वास्तुकला ने युगों-युगों तक भारतीय सौंदर्यशास्त्र को अमर बनाए रखा।",
            "कला वही सार्थक है जो समाज को आनंद के साथ-साथ नैतिक प्रेरणा भी प्रदान करे।"
        ]),
        ("अध्याय ६: कर्तव्य और कर्मयोग", [
            "श्रीमद्भगवद्गीता का निष्काम कर्मयोग मनुष्य को फल की चिंता किए बिना कर्म करने की प्रेरणा देता है।",
            "कर्तव्य पथ पर आने वाली बाधाओं से भयभीत हुए बिना निरंतर आगे बढ़ते रहना ही पुरुषार्थ है।",
            "जब कर्म समर्पण भाव से किया जाता है, तो वह बंधन न बनकर मुक्ति का द्वार बन जाता है।",
            "सच्चा कर्मयोगी वही है जो सफलता और विफलता में समान रूप से स्थिरप्रज्ञ रहता है।"
        ]),
        ("अध्याय ७: पुस्तकालय का सामाजिक महत्व", [
            "पुस्तकालय समाज का बौद्धिक हृदय और ज्ञान का सबसे लोकतांत्रिक मंदिर होता है।",
            "यहाँ प्रत्येक नागरिक को बिना किसी भेदभाव के ज्ञानार्जन करने की स्वतंत्रता मिलती है।",
            "पुस्तकालयों का संरक्षण और विकास किसी भी राष्ट्र के सांस्कृतिक स्वास्थ्य का परिचायक है।",
            "पुस्तकों के बीच बिताया गया समय मनुष्य को विचारशील, संवेदनशील और जागरूक नागरिक बनाता है।"
        ]),
        ("अध्याय ८: सहिष्णुता और विश्वबंधुत्व", [
            "वसुधैव कुटुम्बकम् की उदात्त भावना भारत का संपूर्ण मानवता को दिया गया अनुपम संदेश है।",
            "विविधता में एकता का दर्शन हमारे समाज को सामंजस्य और शक्ति प्रदान करता है।",
            "दूसरों के विचारों का आदर करना और परस्पर संवाद से विवाद सुलझाना ही सभ्य समाज की पहचान है।",
            "शांति और सहअस्तित्व के मार्ग पर चलकर ही विश्व का कल्याण संभव हो सकता है।"
        ]),
        ("अध्याय ९: विज्ञान और अध्यात्म का समन्वय", [
            "विज्ञान और अध्यात्म मानव प्रगति के दो पूरक और आवश्यक पहलू हैं।",
            "विज्ञान बाह्य जगत के नियमों की खोज करता है, जबकि अध्यात्म आंतरिक चेतना को प्रकाशित करता है।",
            "जब वैज्ञानिक दृष्टिकोण के साथ नैतिक मूल्य जुड़ते हैं, तभी मानव जाति का वास्तविक उत्थान होता है।",
            "तर्क और श्रद्धा का संतुलन ही संपूर्ण और संतुलित जीवन दृष्टि का निर्माण करता है।"
        ]),
        ("अध्याय १०: डिजिटल युग में पठन संस्कृति", [
            "आधुनिक सूचना क्रांति ने सूचना प्राप्ति को अत्यंत सुलभ और त्वरित बना दिया है।",
            "परंतु त्वरित सूचना कभी भी गंभीर अध्ययन और मनन का विकल्प नहीं बन सकती।",
            "डिजिटल माध्यमों का उपयोग करते हुए भी शांत और एकाग्र पठन की आदत को बनाए रखना अनिवार्य है।",
            "अक्स पुस्तकालय का उद्देश्य इसी शांत पठन साधना को आधुनिक तकनीक से सुरक्षित रखना है।"
        ]),
    ]

    for i, (title, lines) in enumerate(sample_hindi_chapters):
        img = create_base_canvas()
        draw = ImageDraw.Draw(img)

        draw.text((250, 320), title, font=title_font, fill=(0, 0, 0))
        draw.line((250, 440, 2230, 440), fill=(0, 0, 0), width=4)

        y = 560
        for line in lines:
            draw.text((250, y), line, font=body_font, fill=(0, 0, 0))
            y += 120

        draw.text((PAGE_WIDTH // 2 - 50, PAGE_HEIGHT - 300), f"— {i + 1} —", font=body_font, fill=(80, 80, 80))

        pages.append(img)
        manifest_pages.append({
            "page_number": i + 1,
            "title": title,
            "body_lines": lines,
        })

    pdf_path = SAMPLES_DIR / "04_hindi_10p.pdf"
    pages[0].save(pdf_path, "PDF", resolution=300.0, save_all=True, append_images=pages[1:])

    return str(pdf_path), {
        "language": "hi",
        "page_count": 10,
        "description": "Multi-page Hindi document (10 literary/philosophical chapters) at 300 DPI",
        "pages": manifest_pages,
    }


# ==============================================================================
# 5. One Sanskrit Page (Shlokas & Vedic)
# ==============================================================================
def generate_05_sanskrit_1p():
    img = create_base_canvas()
    draw = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(FONT_DEVA, 70)
    body_font = ImageFont.truetype(FONT_DEVA, 52)

    title = "संस्कृत मन्त्र एवं श्लोक संग्रहः"
    lines = [
        "ॐ असतो मा सद्गमय। तमसो मा ज्योतिर्गमय।",
        "मृत्योर्माऽमृतं गमय॥ ॐ शान्तिः शान्तिः शान्तिः॥",
        "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।",
        "मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि॥",
        "यदा यदा हि धर्मस्य ग्लानिर्भवति भारत।",
        "अभ्युत्थानमधर्मस्य तदात्मानं सृजाम्यहम्॥",
        "अ॒ग्निमी॑ळे पु॒रोहि॑तं य॒ज्ञस्य॑ दे॒वमृ॒त्विज॑म्।",
        "होता॑रं रत्न॒धात॑मम्॥"
    ]

    draw.text((250, 320), title, font=title_font, fill=(0, 0, 0))
    draw.line((250, 440, 2230, 440), fill=(0, 0, 0), width=4)

    y = 560
    for line in lines:
        draw.text((250, y), line, font=body_font, fill=(0, 0, 0))
        y += 115

    pdf_path = SAMPLES_DIR / "05_sanskrit_1p.pdf"
    img.save(pdf_path, "PDF", resolution=300.0)

    return str(pdf_path), {
        "title": title,
        "body_lines": lines,
        "language": "hi",
        "page_count": 1,
        "description": "Classical Sanskrit shlokas and Vedic accents (Upanishads, Gita, Rigveda 1.1.1)",
    }


# ==============================================================================
# 6. Rotated Photographed Page (90° clockwise with smartphone shadows)
# ==============================================================================
def generate_06_rotated_photographed_page():
    img = create_base_canvas()
    draw = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(FONT_EN, 70)
    body_font = ImageFont.truetype(FONT_EN, 48)

    title = "ROTATED SMARTPHONE CAPTURE"
    lines = [
        "Handheld mobile scanning frequently combines orientation skew with non-uniform lighting.",
        "A shadow cast diagonally across a rotated book page introduces compound optical distortions.",
        "The automated document preprocessor must detect the ninety-degree rotation accurately,",
        "re-orient the image grid, and isolate character strokes despite strong illumination gradients."
    ]

    draw.text((250, 380), title, font=title_font, fill=(20, 20, 20))
    draw.line((250, 490, 2230, 490), fill=(20, 20, 20), width=4)

    y = 620
    for line in lines:
        draw.text((250, y), line, font=body_font, fill=(25, 25, 25))
        y += 120

    # Apply diagonal shadow
    arr = np.array(img).astype(np.float32)
    yy, xx = np.mgrid[0:PAGE_HEIGHT, 0:PAGE_WIDTH]
    shadow = 1.0 - 0.55 * ((xx / PAGE_WIDTH) * 0.5 + (yy / PAGE_HEIGHT) * 0.5)
    shadow = np.expand_dims(shadow, axis=-1)
    arr = np.clip(arr * shadow, 0, 255).astype(np.uint8)
    shadowed_img = Image.fromarray(arr)

    # Rotate 90 degrees clockwise (landscape)
    rot_img = shadowed_img.rotate(-90, expand=True)

    pdf_path = SAMPLES_DIR / "06_rotated_photographed_page.pdf"
    rot_img.save(pdf_path, "PDF", resolution=300.0)

    return str(pdf_path), {
        "title": title,
        "body_lines": lines,
        "language": "en",
        "page_count": 1,
        "description": "Page rotated 90° clockwise with severe diagonal smartphone shadow",
    }


# ==============================================================================
# 7. Shadowed Low-Contrast Page (aged paper, faded ink, illumination gradient)
# ==============================================================================
def generate_07_shadowed_low_contrast_page():
    bg_color = (235, 228, 212)
    ink_color = (130, 120, 110)

    img = create_base_canvas(bg_color=bg_color)
    draw = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(FONT_EN, 70)
    body_font = ImageFont.truetype(FONT_EN, 48)

    title = "SHADOWED LOW-CONTRAST ARCHIVE"
    lines = [
        "Historical archival pages combine ink fading, paper oxidation, and ambient illumination shadows.",
        "Standard global binarization fails when the text-to-background contrast ratio drops below 2.5:1.",
        "Deep convolutional detectors must extract stroke gradient features robustly across degraded surfaces.",
        "This benchmark validates resilience under combined lighting falloff and low optical dynamic range."
    ]

    draw.text((250, 380), title, font=title_font, fill=ink_color)
    draw.line((250, 490, 2230, 490), fill=ink_color, width=3)

    y = 620
    for line in lines:
        draw.text((250, y), line, font=body_font, fill=ink_color)
        y += 120

    # Add gradient shadow on top of low-contrast paper
    arr = np.array(img).astype(np.float32)
    yy, xx = np.mgrid[0:PAGE_HEIGHT, 0:PAGE_WIDTH]
    shadow = 1.0 - 0.40 * (xx / PAGE_WIDTH)
    shadow = np.expand_dims(shadow, axis=-1)
    arr = np.clip(arr * shadow, 0, 255).astype(np.uint8)
    shadowed_img = Image.fromarray(arr)

    pdf_path = SAMPLES_DIR / "07_shadowed_low_contrast_page.pdf"
    shadowed_img.save(pdf_path, "PDF", resolution=300.0)

    return str(pdf_path), {
        "title": title,
        "body_lines": lines,
        "language": "en",
        "page_count": 1,
        "description": "Aged yellowed paper with faded ink (<2.5:1 contrast) plus ambient shadow falloff",
    }


def generate_all_samples():
    """Generate all 7 Phase OCR-2.1 benchmark sample suites."""
    manifest = {}

    samples = [
        ("01_english_1p", generate_01_english_1p),
        ("02_english_10p", generate_02_english_10p),
        ("03_hindi_1p", generate_03_hindi_1p),
        ("04_hindi_10p", generate_04_hindi_10p),
        ("05_sanskrit_1p", generate_05_sanskrit_1p),
        ("06_rotated_photographed_page", generate_06_rotated_photographed_page),
        ("07_shadowed_low_contrast_page", generate_07_shadowed_low_contrast_page),
    ]

    for key, generator_fn in samples:
        print(f"Generating Phase OCR-2.1 benchmark sample: {key}...")
        path, gt = generator_fn()
        manifest[key] = {
            "path": path,
            "filename": os.path.basename(path),
            **gt,
        }

    manifest_path = SAMPLES_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"All 7 Phase OCR-2.1 samples generated successfully in {SAMPLES_DIR}")
    return manifest


if __name__ == "__main__":
    generate_all_samples()
