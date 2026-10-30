'use strict';

/* static interface strings: Mongolian → English */
const MN2EN = {
  "Бэлчээр AI – Монголын бэлчээрийн талхагдлын эрсдэл": "Pasture AI – Pasture degradation risk in Mongolia",
  "Бэлчээр AI": "Pasture AI",
  "Эрсдэл тооцох": "Calculate risk",
  "Газрын зураг": "Map",
  "Баримтууд": "Facts",
  "Тусламж": "Help",
  "Загвар ачаалж байна…": "Loading model…",
  "Машин сургалтын загвар · 2010–2025": "Machine-learning model · 2010–2025",
  "Бэлчээрийн талхагдлын эрсдэл тооцох": "Pasture degradation risk score",
  "Малын тоо, NDVI, хур тунадас, температур, ачааллын утгаа оруулахад KNN загвар түүхэн 336 аймаг-жилийн өгөгдөлтэй харьцуулж эрсдэлийн оноог тооцно.": "Enter livestock numbers, NDVI, precipitation, temperature and stocking rate, and the KNN model compares them with 336 historical aimag-years to estimate a risk score.",
  "Үзүүлэлт оруулах": "Input indicators",
  "Анхны утга": "Reset",
  "Бэлэн өгөгдөл": "Preset data",
  "Аймаг сонгох…": "Select aimag…",
  "Жил": "Year",
  "Аймаг, жил сонговол тухайн жилийн бодит үзүүлэлтүүд талбарт орно.": "Choose an aimag and year to load that year's actual indicators into the form.",
  "Нийт мал": "Total livestock",
  "хонин толгойд": "sheep units",
  "толгой": "head",
  "Ургамлын индекс": "Vegetation index",
  "Агаарын хэм": "Air temperature",
  "Хур тунадас": "Precipitation",
  "мм": "mm",
  "Ачааллын коэффициент": "Stocking rate",
  "1.0 = даацтай тэнцүү": "1.0 = at carrying capacity",
  "Сургалтын хүрээ: мал 1.54–7.77 сая · NDVI 0.12–0.50 · хур тунадас 19–463 мм · ачаалал 0.83–3.15. Хүрээнээс гарсан утгыг анхааруулна.": "Training range: livestock 1.54–7.77 M · NDVI 0.12–0.50 · precipitation 19–463 mm · stocking rate 0.83–3.15. Values outside the range are flagged.",
  "Загвар бэлэн": "Model ready",
  "Зүүн талын маягтын утгыг оруулаад «Эрсдэл тооцох» дарна уу. Доор оноо, хүчин зүйлсийн нөлөө, зөвлөмж, сайжруулах хувилбар болон хамгийн төстэй түүхэн жишээнүүд гарна.": "Enter values in the form on the left and press «Calculate risk». You will see the score, factor effects, recommendations, improvement scenarios and the most similar historical cases.",
  "Оноог хэрхэн унших вэ": "How to read the score",
  "0–100 оноо": "0–100 score",
  "Бага": "Low",
  "Тогтвортой, жилийн хяналт хангалттай.": "Stable; annual monitoring is enough.",
  "Дунд": "Medium",
  "Ачаалал, NDVI-г анхаарч хянана.": "Watch stocking rate and NDVI.",
  "Өндөр": "High",
  "Ачааллыг бууруулж, арга хэмжээ авна.": "Reduce stocking pressure and take action.",
  "оноо / 100": "score / 100",
  "Боломжит хүрээ": "Likely range",
  "хөршүүдийн тархалт": "spread of neighbours",
  "Улсын дундаж": "National average",
  "бүх аймаг-жил": "all aimag-years",
  "Харьцуулалт": "Comparison",
  "түүхэн ажиглалт": "historical observations",
  "Хүчин зүйлсийн нөлөөлөл": "Factor effects",
  "Медиан утгатай харьцуулсан зөрүү": "Difference from the median",
  "эрсдэл нэмэгдүүлнэ": "increases risk",
  "эрсдэл бууруулна": "decreases risk",
  "Шалтгаан ба зөвлөмж": "Causes and recommendations",
  "Оруулсан утгад үндэслэсэн": "Based on the entered values",
  "Арга хэмжээний нөлөө": "Effect of measures",
  "Загвараар дахин тооцсон": "Re-scored by the model",
  "Одоогийн утгаас нэг үзүүлэлтийг өөрчилбөл эрсдэлийн оноо хэр өөрчлөгдөхийг тооцов. «Турших» дарж бүрэн дүнг гаргуулна.": "This shows how the risk score changes when one indicator is altered. Press «Apply» to load the full result.",
  "Хамгийн төстэй түүхэн тохиолдлууд": "Most similar historical cases",
  "Аймаг": "Aimag",
  "Он": "Year",
  "Оноо": "Score",
  "Зай": "Distance",
  "Жин": "Weight",
  "Оноо нь эдгээр тохиолдлын оноог зайгаар жинлэсэн дундажаар бодогдоно.": "The score is the distance-weighted average of these cases.",
  "Газрын зураг дээр харах": "View on the map",
  "Утгаа өөрчлөх": "Change values",
  "21 аймаг · 16 жил": "21 aimags · 16 years",
  "Монголын бэлчээрийн эрсдэлийн зураг": "Pasture risk map of Mongolia",
  "Аймаг бүрийн эрсдэлийн оноог он жилээр харьцуулна. Аймаг дээр дарж дэлгэрэнгүй үзүүлэлт, түүхийг харна уу.": "Compare each aimag's risk score across years. Click an aimag to see detailed indicators and its history.",
  "Улсын дундаж оноо · он жилээр": "National average score · by year",
  "Эрсдэлийн зураглал": "Risk map",
  "Газрын зургийг ачаалж байна…": "Loading map…",
  "Чирж зөөх · + / − томруулах": "Drag to pan · + / − to zoom",
  "Эрсдэл": "Risk",
  "Өгөгдөлгүй": "No data",
  "Хилийн геометр: geoBoundaries (OpenStreetMap, ODbL). Өгөгдөл: MODIS NDVI, ERA5, CHIRPS, 1212.mn, FAO/WB — 2010–2025. Улаанбаатарт бэлчээрийн өгөгдөл байхгүй; жижиг аймгуудын нэр томруулахад харагдана.": "Borders: geoBoundaries (OpenStreetMap, ODbL). Data: MODIS NDVI, ERA5, CHIRPS, 1212.mn, FAO/WB — 2010–2025. Ulaanbaatar has no pasture data; small aimag names appear when zoomed in.",
  "Аймаг сонгоно уу": "Select an aimag",
  "Зураг дээрх аймаг дээр дарж эсвэл баруун жагсаалтаас сонгож, жилийн үзүүлэлт, түүхийг харна уу.": "Click an aimag on the map or pick one from the list on the right to see yearly indicators and history.",
  "Хамгийн өндөр эрсдэл": "Highest risk",
  "Бүх аймгийн үзүүлэлт": "All aimags",
  "CSV татах": "Download CSV",
  "Түвшин": "Level",
  "Ачаалал": "Stocking",
  "Өмнөх жил": "Previous year",
  "Дэлхий · Монгол": "World · Mongolia",
  "Бэлчээрийн тухай баримтууд": "Facts about pastures",
  "Дэлхий болон Монголын бэлчээрийн талбай, мал, доройтлын албан ёсны үзүүлэлтүүд.": "Official figures on pasture area, livestock and degradation, globally and in Mongolia.",
  "Дэлхийн бэлчээр": "World pastures",
  "Хуурай газрын бэлчээр": "Pasture share of dryland",
  "Дэлхийн мөсгүй хуурай газрын 30% нь бэлчээр, хээр.": "30% of the world's ice-free dry land is pasture or grassland.",
  "2 тэрбум": "2 billion",
  "Амьдралын эх үүсвэр": "Livelihoods",
  "Бэлчээр, мал аж ахуйгаас амьдралаа залгуулдаг хүний тоо.": "People whose livelihoods depend on pastures and livestock.",
  "Малын тэжээл": "Livestock feed",
  "Дэлхийн мал аж ахуйн тэжээлийн 70% орчим бэлчээрээс гардаг.": "About 70% of global livestock feed comes from pastures.",
  "Хөрсний нүүрстөрөгч": "Soil carbon",
  "Дэлхийн хөрсний органик нүүрстөрөгчийн 20% бэлчээрийн хөрсөнд хуримтлагддаг.": "20% of the world's soil organic carbon is stored in pasture soils.",
  "3.4 тэрбум га": "3.4 billion ha",
  "Бэлчээрийн нийт талбай": "Total pasture area",
  "Дэлхийн бэлчээр, хээрийн нийт талбайн хэмжээ.": "Total area of the world's pastures and grasslands.",
  "Доройтсон хуурай газар": "Degraded dryland",
  "Дэлхийн хуурай газрын 40% хүртэл нь доройтолд өртсөн.": "Up to 40% of the world's dry land is degraded.",
  "Монголын бэлчээр": "Mongolia's pastures",
  "110 сая га": "110 million ha",
  "Бэлчээрийн талбай": "Pasture area",
  "Нутаг дэвсгэрийн 70 орчим хувийг эзэлдэг.": "Covers about 70% of the country's territory.",
  "58.1 сая": "58.1 million",
  "Малын тоо, 2025": "Livestock, 2025",
  "2025 оны эцсийн улсын тооллогоор.": "Final 2025 national livestock census.",
  "247.9 мянга": "247.9 thousand",
  "Малчин өрх": "Herder households",
  "2025 оны эцсийн байдлаар.": "As of the end of 2025.",
  "Доройтсон нутаг": "Degraded land",
  "Нутаг дэвсгэр цөлжилт, газар доройтолд өртсөн.": "Territory affected by desertification and land degradation.",
  "Хэт бэлчээрлэлт": "Overgrazing",
  "Бэлчээрийн 65 орчим хувь нь даацаас хэт ачаалалтай.": "About 65% of pastures are stocked above carrying capacity.",
  "Хонь, ямааны хувь": "Sheep and goat share",
  "Малын нийт тооны 80 гаруй хувийг хонь, ямаа эзэлдэг.": "Sheep and goats make up over 80% of total livestock.",
  "Эх сурвалж: FAO — Global assessment of soil carbon in grasslands (2023), International Year of Rangelands and Pastoralists (2026); UNCCD — Global Land Outlook (2022); Үндэсний статистикийн хороо — 2025 оны мал, малчин өрхийн тооллого; Байгаль орчин, уур амьсгалын өөрчлөлтийн яам — Монгол орны цөлжилтийн атлас (2026), бэлчээрийн хэт ачааллын үнэлгээ.": "Sources: FAO — Global assessment of soil carbon in grasslands (2023), International Year of Rangelands and Pastoralists (2026); UNCCD — Global Land Outlook (2022); National Statistics Office — 2025 livestock and herder household census; Ministry of Environment and Climate Change — Desertification Atlas of Mongolia (2026), pasture overstocking assessment.",
  "Заавар": "Guide",
  "Тусламж ба тайлбар": "Help and explanations",
  "Системийн ажиллагаа, загварын дэлгэрэнгүй мэдээлэл ба газрын зургийн удирдлага.": "How the system works, model details and map controls.",
  "Системийн ажиллагаа": "How the system works",
  "Аймаг, он сонгох": "Choose an aimag and year",
  "«Бэлэн өгөгдөл»-өөс аймаг, жилээ сонговол тухайн жилийн бодит үзүүлэлтүүд маягт руу шууд орно.": "Pick an aimag and year under «Preset data» and that year's actual indicators load into the form.",
  "«Эрсдэл тооцох» товч дармагц 0–100 оноо болон эрсдэлийн түвшин гарна.": "Press «Calculate risk» to get a 0–100 score and the risk level.",
  "Түүхэн жишээ ба зөвлөмж": "Historical cases and recommendations",
  "Хамгийн төстэй 5 тохиолдол, шалтгаан, зөвлөмж болон арга хэмжээний нөлөөтэй танилцана.": "Review the 5 most similar cases, the causes, recommendations and the effect of measures.",
  "Загварын дэлгэрэнгүй": "Model details",
  "Газрын зургийн удирдлага": "Map controls",
  "Он сонгох": "Choose year",
  "«Он» сонголтоор 2010–2025 оны аль ч жилийн зургийг харна.": "Use the «Year» selector to view the map for any year from 2010 to 2025.",
  "Томруулах": "Zoom",
  "+ / − товчоор томруулж, чирж зөөнө. ⟲ нь анхны хэмжээнд буцаана.": "Zoom with + / − and drag to pan. ⟲ resets the view.",
  "Аймаг хайх": "Searching for an aimag",
  "Хайлтын талбарт нэр бичиж аймгийг шууд сонгоно.": "Type a name in the search box to select the aimag directly.",
  "Дэлгэрэнгүй": "Details",
  "Аймаг дээр дарахад оноо, 5 үзүүлэлт, 2010–2025 оны түүх гарна.": "Click an aimag to see its score, 5 indicators and 2010–2025 history.",
  "Тооцоололд шилжих": "Moving to the calculator",
  "Сонгосон аймгийн тухайн жилийн утгыг маягт руу нэг товчоор шилжүүлнэ.": "With one button, copy the selected aimag-year values into the form.",
  "Түгээмэл асуулт": "FAQ",
  "Оноо яг юу гэсэн үг вэ?": "What exactly does the score mean?",
  "0–100 оноо нь оруулсан нөхцөлтэй хамгийн төстэй 5 түүхэн аймаг-жилийн эрсдэлийн жигнэсэн дундаж юм. Өндөр оноо нь бэлчээр доройтох эрсдэл их гэсэн үг.": "The 0–100 score is the weighted average of the 5 historical aimag-years most similar to your inputs. A higher score means a higher risk of pasture degradation.",
  "Оноо хэр найдвартай вэ?": "How reliable is the score?",
  "Загварын дундаж алдаа 5.7 оноо, эрсдэлийн түвшний тааруулалт 88%. Сургалтын хүрээнээс гарсан утга оруулбал анхааруулга гарч, үр дүнгийн найдвар буурна.": "The model's mean error is 5.7 points and risk-level agreement is 88%. Values outside the training range raise a warning and reduce reliability.",
  "Яагаад зарим арга хэмжээ оноог өсгөдөг вэ?": "Why do some measures raise the score?",
  "KNN нь шалтгааныг биш, ижил төстэй байдлыг хэмждэг. Түүхэнд ийм хослол өндөр оноотой байсан бол тооцоолол өснө. Тиймээс «Арга хэмжээний нөлөө»-г чиглэл заасан тооцоолол гэж үзэх хэрэгтэй.": "KNN measures similarity, not causation. If such a combination had a high score in history, the estimate rises. Treat «Effect of measures» as a directional estimate.",
  "Газрын зургийн оноо миний тооцоололтой ижил уу?": "Is the map score the same as my calculation?",
  "Үгүй. Зурагт аймаг-жил бүрийг өөрийгөө хөрш болгохгүй (leave-one-out) аргаар боддог тул ижил утга оруулсан ч бага зэрэг ялгаатай байж болно.": "No. Each aimag-year on the map is scored with leave-one-out, so even the same values can differ slightly.",
  "Яагаад Улаанбаатар газрын зурагт байхгүй вэ?": "Why is Ulaanbaatar not on the map?",
  "Улаанбаатарт бэлчээрийн жилийн үзүүлэлт (NDVI, ачаалал) байхгүй тул зөвхөн 21 аймгийг харуулдаг.": "Ulaanbaatar has no annual pasture indicators (NDVI, stocking), so only 21 aimags are shown.",
  "Өгөгдлийг татаж авах боломжтой юу?": "Can I download the data?",
  "Тийм. «Газрын зураг» хуудасны доорх «CSV татах» товчоор 21 аймаг × 16 жилийн бүх үзүүлэлтийг татна.": "Yes. Use the «Download CSV» button on the «Map» page to get all indicators for 21 aimags × 16 years.",
  "— Монголын бэлчээрийн талхагдлын эрсдэлийн судалгааны хэрэгсэл": "— A research tool for pasture degradation risk in Mongolia",
  "Монголын 21 аймгийн бэлчээрийн талхагдлын эрсдэлийг малын тоо, ургамлын индекс (NDVI), хур тунадас, ачаалалаас KNN загвараар тооцож, газрын зураг дээр харьцуулан харуулдаг сайт.": "A site that estimates pasture degradation risk for Mongolia's 21 aimags with a KNN model using livestock numbers, the vegetation index (NDVI), precipitation and stocking rate, and compares the results on a map.",
};

/* attribute overrides take precedence over the text dictionary */
const ATTR_EN = {
  "Бэлчээр AI – нүүр хуудас": "Pasture AI – home",
  "Үндсэн цэс": "Main menu",
  "Хэл сонгох": "Language",
  "Нийт мал, гулсуур": "Total livestock slider",
  "NDVI, гулсуур": "NDVI slider",
  "Температур, гулсуур": "Temperature slider",
  "Хур тунадас, гулсуур": "Precipitation slider",
  "Ачааллын коэффициент, гулсуур": "Stocking rate slider",
  "Он сонгох": "Select year",
  "Жижигрүүлэх": "Zoom out",
  "Томруулах": "Zoom in",
  "Анхны хэмжээнд буцаах": "Reset zoom",
  "Аймаг хайх…": "Search aimag…",
  "Аймаг хайх": "Search aimag",
  "Монгол улсын 21 аймгийн бэлчээрийн эрсдэлийн газрын зураг": "Pasture risk map of the 21 aimags of Mongolia",
};

const AIMAG_EN = {
  "Архангай": "Arkhangai", "Баян-Өлгий": "Bayan-Ölgii", "Баянхонгор": "Bayankhongor",
  "Булган": "Bulgan", "Говь-Алтай": "Govi-Altai", "Говьсүмбэр": "Govisümber",
  "Дархан-Уул": "Darkhan-Uul", "Дорноговь": "Dornogovi", "Дорнод": "Dornod",
  "Дундговь": "Dundgovi", "Завхан": "Zavkhan", "Орхон": "Orkhon",
  "Сэлэнгэ": "Selenge", "Сүхбаатар": "Sükhbaatar", "Төв": "Töv", "Увс": "Uvs",
  "Ховд": "Khovd", "Хэнтий": "Khentii", "Хөвсгөл": "Khövsgöl",
  "Өвөрхангай": "Övörkhangai", "Өмнөговь": "Ömnögovi",
};

window.I18N = (function () {
  const ATTRS = ["placeholder", "aria-label", "title", "alt"];
  const textOrig = new WeakMap();
  const attrOrig = new WeakMap();
  const docTitle = document.title;
  const metaDesc = document.querySelector('meta[name="description"]');

  let lang = "mn";

  function getLang() { return lang; }

  function setLang(value) {
    lang = value === "en" ? "en" : "mn";
    document.documentElement.lang = lang;
  }

  function t(mn, en) {
    return lang === "en" ? (en !== undefined ? en : (MN2EN[mn] ?? mn)) : mn;
  }

  function aimag(name) {
    return lang === "en" ? (AIMAG_EN[name] || name) : name;
  }

  function trText(node, isEn) {
    if (node.parentElement?.closest("script,style,svg,textarea")) return;
    const raw = node.nodeValue;
    const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m || !m[2]) return;
    if (isEn) {
      const en = MN2EN[m[2]];
      if (!en || en === m[2]) return;
      if (!textOrig.has(node)) textOrig.set(node, raw);
      node.nodeValue = m[1] + en + m[3];
    } else {
      const orig = textOrig.get(node);
      if (orig != null) {
        node.nodeValue = orig;
        textOrig.delete(node);
      }
    }
  }

  function trAttrs(el, isEn) {
    let store = attrOrig.get(el);
    for (const name of ATTRS) {
      const cur = el.getAttribute(name);
      if (cur == null) continue;
      const key = cur.trim();
      if (isEn) {
        const en = ATTR_EN[key] || MN2EN[key];
        if (!en || en === cur) continue;
        if (!store) { store = {}; attrOrig.set(el, store); }
        if (!(name in store)) store[name] = cur;
        el.setAttribute(name, en);
      } else if (store && name in store) {
        el.setAttribute(name, store[name]);
        delete store[name];
      }
    }
  }

  function walk(node, isEn) {
    if (node.nodeType === Node.TEXT_NODE) { trText(node, isEn); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    trAttrs(node, isEn);
    for (const child of Array.from(node.childNodes)) walk(child, isEn);
  }

  function apply() {
    const isEn = lang === "en";
    document.title = isEn ? (MN2EN[docTitle] || docTitle) : docTitle;
    if (metaDesc) {
      const orig = metaDesc.dataset.mn || metaDesc.getAttribute("content") || "";
      if (!metaDesc.dataset.mn) metaDesc.dataset.mn = orig;
      metaDesc.setAttribute("content", isEn ? (MN2EN[orig] || orig) : orig);
    }
    walk(document.body, isEn);
  }

  return { getLang, setLang, t, aimag, apply };
}());
