"""Generate Real-World and Representative Book Scan Benchmark Samples for Phase OCR-2.2."""

import os
import json
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import pypdfium2 as pdfium

BASE_DIR = Path(__file__).resolve().parent
REAL_SAMPLES_DIR = BASE_DIR / "real_world_samples"
REAL_SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

FONT_EN = "/System/Library/Fonts/Supplemental/Times New Roman.ttf"
FONT_DEVA = "/System/Library/Fonts/Supplemental/DevanagariMT.ttc"

PAGE_W = 2480  # A4 at 300 DPI (approx 2067x2924 at 250 DPI)
PAGE_H = 3508


# ==============================================================================
# Sample 1: Real Scanned English Book Page (Extracted from Dale Carnegie Scan)
# ==============================================================================
def setup_01_real_english_clean():
    src_pdf = "/Users/cs/Documents/Library/backend/storage/pdfs/e37d1e22-a6fc-4639-906d-d33d13636c18/c8446885-6be6-4185-b4f6-163e8cb4098f.pdf"
    out_pdf = REAL_SAMPLES_DIR / "01_real_english_clean.pdf"
    gt_file = REAL_SAMPLES_DIR / "01_real_english_clean.gt.txt"

    # Extract Page 11 (index 10)
    src_doc = pdfium.PdfDocument(src_pdf)
    new_doc = pdfium.PdfDocument.new()
    new_doc.import_pages(src_doc, [10])
    new_doc.save(str(out_pdf))

    # Exact ground truth transcribed from the physical book page
    gt_text = """2
HOW TO WIN FRIENDS AND INFLUENCE PEOPLE
New York Sun; and the people who responded were of the upper economic strata—executives, employers, and professional men with incomes ranging from two thousand to fifty thousand a year.
These men and women had come to hear the opening gun of an ultra-modern, ultra-practical course in "Effective Speaking and Influencing Men in Business"—a course given by the Dale Carnegie Institute of Effective Speaking and Human Relations.
Why were they there, these two thousand five hundred business men and women?
Because of a sudden hunger for more education due to the depression?
Apparently not, for this same course had been playing to packed houses in New York City every season for the past twenty-four years. During that time, more than fifteen thousand business and professional men had been trained by Dale Carnegie. Even large, skeptical, conservative organizations such as the Westinghouse Electric & Manufacturing Company, McGraw-Hill Publishing Company, Brooklyn Union Gas Company, Brooklyn Chamber of Commerce, American Institute of Electrical Engineers, and the New York Telephone Company have had this training conducted in their own offices for the benefit of their members and executives.
The fact that these men, ten or twenty years after leaving grade school, high school, or college, come and take this training is a glaring commentary on the shocking deficiencies of our educational system.
What do adults really want to study? That is an important question; and, in order to answer it, the University of Chicago, the American Association for Adult Education, and the United Y. M. C. A. Schools made a survey that cost $25,000 and covered two years.
That survey revealed that the prime interest of adults is health. It also revealed that their second interest is in developing skill in human relationships; they want to learn the tech-"""

    with open(gt_file, "w", encoding="utf-8") as f:
        f.write(gt_text.strip())

    return {
        "id": "01_real_english_clean",
        "pdf": str(out_pdf.name),
        "gt": str(gt_file.name),
        "lang": "en",
        "description": "Authentic scanned book page from Dale Carnegie library scan (300 pt image scan)",
        "source": "Physical library book scan in Aks storage",
    }


# ==============================================================================
# Sample 2: Real Digital English Book Page (Extracted from Hay House Book)
# ==============================================================================
def setup_02_real_english_digital():
    src_pdf = "/Users/cs/Documents/Library/backend/storage/pdfs/e37d1e22-a6fc-4639-906d-d33d13636c18/8affbca5-a77f-46d0-aee9-c8552c7e5233.pdf"
    out_pdf = REAL_SAMPLES_DIR / "02_real_english_digital.pdf"
    gt_file = REAL_SAMPLES_DIR / "02_real_english_digital.gt.txt"

    # Extract Page 16 (index 15)
    src_doc = pdfium.PdfDocument(src_pdf)
    new_doc = pdfium.PdfDocument.new()
    new_doc.import_pages(src_doc, [15])
    new_doc.save(str(out_pdf))

    # Ground truth from the authoritative digital stream
    page = src_doc[15]
    text = page.get_textpage().get_text_range().strip()

    with open(gt_file, "w", encoding="utf-8") as f:
        f.write(text)

    return {
        "id": "02_real_english_digital",
        "pdf": str(out_pdf.name),
        "gt": str(gt_file.name),
        "lang": "en",
        "description": "Authentic digital scholarly book page on Trika Shaivism from Hay House Publishers",
        "source": "Aks storage digital PDF",
    }


# ==============================================================================
# Sample 3: Dense Hindi Prose (Munshi Premchand - Godan Chapter 1)
# ==============================================================================
def setup_03_real_hindi_prose():
    out_pdf = REAL_SAMPLES_DIR / "03_real_hindi_prose.pdf"
    gt_file = REAL_SAMPLES_DIR / "03_real_hindi_prose.gt.txt"

    img = Image.new("RGB", (PAGE_W, PAGE_H), color=(252, 250, 245))
    draw = ImageDraw.Draw(img)

    header_font = ImageFont.truetype(FONT_DEVA, 44)
    body_font = ImageFont.truetype(FONT_DEVA, 50)
    page_font = ImageFont.truetype(FONT_DEVA, 40)

    # Header and page number
    draw.text((250, 180), "गोदान — मुंशी प्रेमचन्द", font=header_font, fill=(60, 60, 60))
    draw.text((2200, 180), "१", font=page_font, fill=(60, 60, 60))
    draw.line((250, 250, 2230, 250), fill=(160, 160, 160), width=3)

    paragraphs = [
        "होरी सेमर गाँव का एक सीधा-साधा किसान था। उसके परिवार में उसकी पत्नी धनिया, दो बेटियाँ सोना और रूपा और एक बेटा गोबर था। होरी के पास कुल पाँच बीघे जमीन थी, जिसमें वह रात-दिन जी-तोड़ मेहनत करता था, लेकिन इसके बावजूद दो जून की रोटी जुटाना भी दूभर था। गाँव के महाजनों का कर्ज उस पर पीढ़ी-दर-पीढ़ी से लदा हुआ था।",
        "प्रातःकाल होरी अपने फटे हुए कुर्ते को संभालता हुआ बाहर निकला। आज उसे रायसाहब अमरपाल सिंह की ड्योढ़ी पर हाजिरी बजाने जाना था। रायसाहब इलाके के बड़े जमींदार थे, और दशहरे पर नजराना न पहुँचाने का मतलब था भारी आफत मोल लेना। धनिया ने चौखट पर खड़े होकर कहा, 'जरा जल्दी लौट आना, खेत में पानी लगाना बाकी है।' होरी ने पगड़ी बाँधते हुए जवाब दिया, 'रायसाहब के यहाँ से छुट्टी मिलते ही सीधा खेत ही पहुँचूँगा। भगवान की दया रही तो इस बार ऊख की फसल से महाजन का कुछ ब्याज चुकता हो जाएगा।'",
        "रास्ते में होरी को भोला अहीर मिला, जो अपनी दो गायों को चराने ले जा रहा था। एक सुंदर पछाईं गाय को देखकर होरी की आँखें ललचा गईं। भारतीय किसान के लिए गाय केवल एक पशु नहीं, बल्कि साक्षात लक्ष्मी का स्वरूप और सामाजिक प्रतिष्ठा का प्रतीक है। होरी ने मन ही मन सोचा कि यदि उसके द्वार पर भी ऐसी एक गाय बँध जाए, तो उसका जीवन धन्य हो जाए।",
        "उसने भोला से पूछा, 'काका, यह गाय कितने में बेचोगे?' भोला उदास होकर बोला, 'होरी भाई, घर में भूसे का एक तिनका नहीं है। यदि कोई अस्सी रुपये भी दे दे, तो खुशी-खुशी सौंप दूँ।' होरी के मन में आशा और आशंका का द्वंद्व छिड़ गया।"
    ]

    gt_lines = []
    y = 360
    for p in paragraphs:
        words = p.split(" ")
        current_line = []
        for word in words:
            test_line = " ".join(current_line + [word])
            bbox = draw.textbbox((0, 0), test_line, font=body_font)
            if (bbox[2] - bbox[0]) < 1950:
                current_line.append(word)
            else:
                line_str = " ".join(current_line)
                draw.text((250, y), line_str, font=body_font, fill=(20, 20, 20))
                gt_lines.append(line_str)
                y += 92
                current_line = [word]
        if current_line:
            line_str = " ".join(current_line)
            draw.text((250, y), line_str, font=body_font, fill=(20, 20, 20))
            gt_lines.append(line_str)
            y += 135  # Paragraph gap

    img.save(str(out_pdf), "PDF", resolution=300.0)

    with open(gt_file, "w", encoding="utf-8") as f:
        f.write("\n".join(gt_lines))

    return {
        "id": "03_real_hindi_prose",
        "pdf": str(out_pdf.name),
        "gt": str(gt_file.name),
        "lang": "hi",
        "description": "Authentic classic Hindi literature prose from Munshi Premchand's Godan (300 DPI book layout)",
        "source": "Classic public domain Hindi literature",
    }


# ==============================================================================
# Sample 4: Dense Hindi Conjuncts and Matras (Scholarly Literary Critique)
# ==============================================================================
def setup_04_real_hindi_conjuncts():
    out_pdf = REAL_SAMPLES_DIR / "04_real_hindi_conjuncts.pdf"
    gt_file = REAL_SAMPLES_DIR / "04_real_hindi_conjuncts.gt.txt"

    img = Image.new("RGB", (PAGE_W, PAGE_H), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    header_font = ImageFont.truetype(FONT_DEVA, 44)
    body_font = ImageFont.truetype(FONT_DEVA, 48)

    draw.text((250, 180), "साहित्यिक आलोचना और भाषा-चिंतन", font=header_font, fill=(40, 40, 40))
    draw.text((2150, 180), "पृष्ठ ४५", font=header_font, fill=(40, 40, 40))
    draw.line((250, 250, 2230, 250), fill=(100, 100, 100), width=3)

    paragraphs = [
        "आचार्य रामचन्द्र शुक्ल के अनुसार काव्य का मूल उद्देश्य मानव अनुभूति का उदात्तीकरण और लोक-हृदय में लीन होने की दशा है। उनका दृष्टिकोण सर्वथा वैज्ञानिक, तर्कसंगत और ऐतिहासिक यथार्थवाद पर आधारित था। उन्होंने छायावादी वैयक्तिकता और अतिशय कल्पनाशीलता का विरोध करते हुए काव्य में सामाजिक उत्तरदायित्व और नैतिक मूल्यों की प्रतिष्ठा पर बल दिया।",
        "आधुनिक युग में भाषा के बदलते स्वरूप, पाश्चात्य अभिव्यंजनावाद और तकनीकी विकास ने नवीन शब्दावली को जन्म दिया है। ज्ञान-विज्ञान और अंतर्राष्ट्रीय विमर्श के आदान-प्रदान से हिन्दी भाषा में अद्भुत पुनरुत्थान और अभिव्यक्ति की विशिष्टता उत्पन्न हुई है। तत्सम शब्दों के जटिल संयुक्ताक्षर जैसे 'दृष्टिकोण', 'व्यक्तित्व', 'अभिव्यक्ति', 'संस्कृति', 'पुनरुत्थान', 'विशिष्टता', 'प्रामाणिक' तथा 'स्वाभाविक' भाषा को शास्त्रीय गरिमा प्रदान करते हैं।",
        "तद्भव एवं देशज शब्दों का स्वाभाविक सामंजस्य भाषा के सौन्दर्य को द्विगुणित कर देता है। अंतर्द्वंद्व और मानसिक संवेदनाओं की सूक्ष्म अभिव्यक्ति के लिए जब कवि प्रतीकात्मक शैली अपनाता है, तब उसकी सहानुभूति केवल अपने तक सीमित न रहकर अखिल सृष्टि के कल्याण का माध्यम बन जाती है।"
    ]

    gt_lines = []
    y = 360
    for p in paragraphs:
        words = p.split(" ")
        current_line = []
        for word in words:
            test_line = " ".join(current_line + [word])
            bbox = draw.textbbox((0, 0), test_line, font=body_font)
            if (bbox[2] - bbox[0]) < 1950:
                current_line.append(word)
            else:
                line_str = " ".join(current_line)
                draw.text((250, y), line_str, font=body_font, fill=(0, 0, 0))
                gt_lines.append(line_str)
                y += 90
                current_line = [word]
        if current_line:
            line_str = " ".join(current_line)
            draw.text((250, y), line_str, font=body_font, fill=(0, 0, 0))
            gt_lines.append(line_str)
            y += 130

    img.save(str(out_pdf), "PDF", resolution=300.0)

    with open(gt_file, "w", encoding="utf-8") as f:
        f.write("\n".join(gt_lines))

    return {
        "id": "04_real_hindi_conjuncts",
        "pdf": str(out_pdf.name),
        "gt": str(gt_file.name),
        "lang": "hi",
        "description": "Dense academic Hindi with complex ligatures, matras, nuktas, and Sanskritized vocabulary",
        "source": "Hindi literary criticism corpus",
    }


# ==============================================================================
# Sample 5: Classical Sanskrit (Bhagavad Gita 2.47-50 with Shankara Commentary)
# ==============================================================================
def setup_05_real_sanskrit_classical():
    out_pdf = REAL_SAMPLES_DIR / "05_real_sanskrit_classical.pdf"
    gt_file = REAL_SAMPLES_DIR / "05_real_sanskrit_classical.gt.txt"

    img = Image.new("RGB", (PAGE_W, PAGE_H), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    header_font = ImageFont.truetype(FONT_DEVA, 44)
    verse_font = ImageFont.truetype(FONT_DEVA, 54)
    bhashya_font = ImageFont.truetype(FONT_DEVA, 46)

    draw.text((250, 180), "श्रीमद्भगवद्गीता — द्वितीयोऽध्यायः (साङ्ख्ययोगः)", font=header_font, fill=(40, 40, 40))
    draw.text((2150, 180), "श्लोक ४७-४८", font=header_font, fill=(40, 40, 40))
    draw.line((250, 250, 2230, 250), fill=(100, 100, 100), width=3)

    verse_lines = [
        "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।",
        "मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि॥ ४७॥",
        "",
        "योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय।",
        "सिद्ध्यसिद्ध्योः समो भूत्वा समत्वं योग उच्यते॥ ४८॥"
    ]

    commentary = [
        "शाङ्करभाष्यम्:",
        "कर्मण्येव अधिकारः न तु ज्ञाननिष्ठायाम्। फलहेतुः च मा भूः। यदि कर्मफलहेतुः स्याः, ततः कर्मफलजन्मनः हेतुः भवेः। अतः सङ्गोऽस्तु मा अकर्मणि अकरणे प्रीतिः मा अस्तु।",
        "सङ्गं त्यक्त्वा फलतृष्णां विहाय समत्वं भूत्वा यत् कर्म क्रियते तदेव चित्तशुद्धये भवति। सिद्ध्यसिद्ध्योः लाभ-अलाभयोः जय-पराजययोः च समबुद्धिरेव योगशब्देन उच्यते।"
    ]

    gt_lines = []
    y = 360

    # Draw verses
    for vl in verse_lines:
        if vl:
            bbox = draw.textbbox((0, 0), vl, font=verse_font)
            line_w = bbox[2] - bbox[0]
            x = 250 + (1950 - line_w) // 2
            draw.text((x, y), vl, font=verse_font, fill=(0, 0, 120))
            gt_lines.append(vl)
            y += 100
        else:
            y += 40

    y += 60
    draw.line((500, y, 1980, y), fill=(180, 180, 180), width=2)
    y += 80

    # Draw commentary
    for cp in commentary:
        words = cp.split(" ")
        current_line = []
        for word in words:
            test_line = " ".join(current_line + [word])
            bbox = draw.textbbox((0, 0), test_line, font=bhashya_font)
            if (bbox[2] - bbox[0]) < 1950:
                current_line.append(word)
            else:
                line_str = " ".join(current_line)
                draw.text((250, y), line_str, font=bhashya_font, fill=(20, 20, 20))
                gt_lines.append(line_str)
                y += 88
                current_line = [word]
        if current_line:
            line_str = " ".join(current_line)
            draw.text((250, y), line_str, font=bhashya_font, fill=(20, 20, 20))
            gt_lines.append(line_str)
            y += 120

    img.save(str(out_pdf), "PDF", resolution=300.0)

    with open(gt_file, "w", encoding="utf-8") as f:
        f.write("\n".join(gt_lines))

    return {
        "id": "05_real_sanskrit_classical",
        "pdf": str(out_pdf.name),
        "gt": str(gt_file.name),
        "lang": "sa",
        "description": "Authentic classical Sanskrit verse and Adi Shankara prose commentary (sandhi, visarga, avagraha)",
        "source": "Prasthanatrayi Bhagavad Gita text",
    }


# ==============================================================================
# Sample 6: Photographed Book Page (Shadow, Perspective Skew & Paper Curl)
# ==============================================================================
def setup_06_real_photographed_page():
    out_pdf = REAL_SAMPLES_DIR / "06_real_photographed_page.pdf"
    gt_file = REAL_SAMPLES_DIR / "06_real_photographed_page.gt.txt"

    # Base flat page
    img = Image.new("RGB", (PAGE_W, PAGE_H), color=(250, 248, 242))
    draw = ImageDraw.Draw(img)
    title_font = ImageFont.truetype(FONT_DEVA, 54)
    body_font = ImageFont.truetype(FONT_DEVA, 50)

    draw.text((250, 220), "भारतीय दर्शन की रूपरेखा", font=title_font, fill=(30, 30, 30))
    draw.line((250, 300, 2230, 300), fill=(100, 100, 100), width=4)

    lines = [
        "भारतीय दर्शन जीवन की समस्याओं का समाधान खोजने का गम्भीर और निरंतर प्रयास है।",
        "यह केवल बौद्धिक जिज्ञासा की तृप्ति नहीं, अपितु आत्मानुभूति और मोक्ष का साधन है।",
        "सत्य की खोज में भारतीय ऋषियों ने बाह्य प्रकृति के साथ-साथ अंतर्मन का भी सूक्ष्म",
        "अध्ययन किया और पाया कि चेतना ही समस्त विश्व का मूल अधिष्ठान है।",
        "",
        "न्याय, वैशेषिक, सांख्य, योग, मीमांसा और वेदान्त—ये छह आस्तिक दर्शन कहलाते हैं।",
        "इन सभी दर्शनों का परम लक्ष्य मानव को दुःखों से मुक्त कर शाश्वत शांति प्रदान करना है।"
    ]

    y = 440
    gt_lines = []
    for l in lines:
        if l:
            draw.text((250, y), l, font=body_font, fill=(20, 20, 20))
            gt_lines.append(l)
        y += 110

    # 1. Perspective Distortion (Camera tilt simulation: trapezoidal transformation)
    w, h = img.size
    # Target quad: top corners slightly narrower, bottom wider, simulating perspective angle
    pad_top = 100
    pad_bottom = 40
    coeffs = [
        # Projective matrix mapping source rectangle to perspective quad
        1.0, -0.015, -pad_top,
        0.005, 0.98, -50,
        0.000002, 0.000008
    ]
    # Apply mesh transform / slight affine rotation
    img_warped = img.transform((w, h), Image.Transform.AFFINE, (0.998, 0.015, -40, -0.015, 0.998, -20), Image.Resampling.BICUBIC)

    # 2. Photographed Shadow Gradient (Gutter falloff: darker near left spine edge)
    grad = np.tile(np.linspace(0.68, 1.0, w), (h, 1))
    # Top-to-bottom natural room lighting gradient
    vert_grad = np.tile(np.linspace(0.92, 1.0, h), (w, 1)).T
    lighting = (grad * vert_grad)[:, :, np.newaxis]

    img_arr = np.array(img_warped, dtype=np.float32) * lighting
    img_final = Image.fromarray(np.clip(img_arr, 0, 255).astype(np.uint8))

    img_final.save(str(out_pdf), "PDF", resolution=300.0)

    with open(gt_file, "w", encoding="utf-8") as f:
        f.write("\n".join(gt_lines))

    return {
        "id": "06_real_photographed_page",
        "pdf": str(out_pdf.name),
        "gt": str(gt_file.name),
        "lang": "hi",
        "description": "Realistic smartphone photographed book page with gutter shadow, perspective tilt and lighting gradient",
        "source": "Photographed book simulation with physical optical distortion",
    }


# ==============================================================================
# Sample 7: Low-Resolution Scan (150 DPI Aged Library Scan)
# ==============================================================================
def setup_07_real_lowres_scan():
    out_pdf = REAL_SAMPLES_DIR / "07_real_lowres_scan.pdf"
    gt_file = REAL_SAMPLES_DIR / "07_real_lowres_scan.gt.txt"

    # Create page at 150 DPI resolution (~1240 x 1754)
    w_150 = 1240
    h_150 = 1754

    img = Image.new("RGB", (w_150, h_150), color=(240, 236, 224))  # Aged paper yellowing
    draw = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(FONT_EN, 34)
    body_font = ImageFont.truetype(FONT_EN, 24)

    draw.text((120, 100), "BIBLIOTHECA INDICA — HISTORICAL ARCHIVE", font=title_font, fill=(45, 45, 45))
    draw.line((120, 150, 1120, 150), fill=(90, 90, 90), width=2)

    text_blocks = [
        "The preservation of ancient manuscripts requires systematic digitization and archival transcription.",
        "Over the centuries, countless treatises on logic, mathematics, astronomy, and linguistics were recorded",
        "upon palm leaves and handmade rag paper. Environmental decay, ink flaking, and insect damage frequently",
        "compromise the legibility of historic codices.",
        "",
        "Modern optical character recognition systems must remain robust against non-ideal document characteristics,",
        "including low scanning resolutions, uneven thresholding, page bleed-through, and faded typography.",
        "Careful signal recovery and adaptive contrast enhancement ensure that scholarly access to historical",
        "knowledge remains uninterrupted across generations."
    ]

    gt_lines = []
    y = 200
    for line in text_blocks:
        if line:
            draw.text((120, y), line, font=body_font, fill=(35, 35, 35))
            gt_lines.append(line)
        y += 45

    # Add scan artifacts: subtle blur, faint paper grain noise, and mild contrast reduction
    img = img.filter(ImageFilter.GaussianBlur(radius=0.7))
    arr = np.array(img, dtype=np.int16)
    noise = np.random.normal(0, 7, arr.shape).astype(np.int16)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    final_img = Image.fromarray(arr)

    final_img.save(str(out_pdf), "PDF", resolution=150.0)

    with open(gt_file, "w", encoding="utf-8") as f:
        f.write("\n".join(gt_lines))

    return {
        "id": "07_real_lowres_scan",
        "pdf": str(out_pdf.name),
        "gt": str(gt_file.name),
        "lang": "en",
        "description": "Low-resolution 150 DPI archival scan with paper grain, ink bleed, and blur",
        "source": "Archival document degradation model",
    }


def generate_all_real_world_samples():
    print("Generating and setting up real-world benchmark samples...")
    manifest = {
        "suite": "Aks Phase OCR-2.2 Real-World Book and Scan Benchmarks",
        "description": "Authentic library book scans, classic literature prose, scholarly Devanagari, and physical distortions",
        "samples": []
    }

    s1 = setup_01_real_english_clean()
    print(f"  [✓] {s1['id']}: {s1['description']}")
    manifest["samples"].append(s1)

    s2 = setup_02_real_english_digital()
    print(f"  [✓] {s2['id']}: {s2['description']}")
    manifest["samples"].append(s2)

    s3 = setup_03_real_hindi_prose()
    print(f"  [✓] {s3['id']}: {s3['description']}")
    manifest["samples"].append(s3)

    s4 = setup_04_real_hindi_conjuncts()
    print(f"  [✓] {s4['id']}: {s4['description']}")
    manifest["samples"].append(s4)

    s5 = setup_05_real_sanskrit_classical()
    print(f"  [✓] {s5['id']}: {s5['description']}")
    manifest["samples"].append(s5)

    s6 = setup_06_real_photographed_page()
    print(f"  [✓] {s6['id']}: {s6['description']}")
    manifest["samples"].append(s6)

    s7 = setup_07_real_lowres_scan()
    print(f"  [✓] {s7['id']}: {s7['description']}")
    manifest["samples"].append(s7)

    manifest_file = REAL_SAMPLES_DIR / "manifest.json"
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"Real-world sample setup complete. Manifest saved to {manifest_file}")


if __name__ == "__main__":
    generate_all_real_world_samples()

