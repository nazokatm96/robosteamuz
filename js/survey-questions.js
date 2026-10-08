// Survey content for survey.html (rendered by js/survey.js). Edit questions here; no other file needs to change.
//
// TODO: the question texts and options below are DRAFTS written from the topic list only. Replace them with the exact
// wording and options from the original questionnaire before publishing. Keep each question's id (q1..q10) stable:
// answers are stored in survey_responses.answers as {"q1": ..., "q2": ...}.
//
// Question fields:
//   id       answers key (q1..q10)
//   text     question text
//   type     'single' (radio) or 'multi' (checkboxes, at least one required)
//   options  answer texts; the chosen text itself is what gets stored
//   scale    true = numeric scale (shown as a compact row of number chips); hint explains the ends of the scale
//   extra    optional text field under the options: { key, label, required, when }
//            with `when`, the field only appears (and is only required) when that option is selected
//
// AGE_RANGES, TEACHER_AGE_RANGES and REGIONS must match the check constraints in supabase/survey-schema.sql.
window.SURVEY = {
  AGE_RANGES: ['7-9 yosh', '10-12 yosh', '13-15 yosh', '16-18 yosh'],
  TEACHER_AGE_RANGES: ['20-29 yosh', '30-39 yosh', '40-49 yosh', '50+ yosh'],
  REGIONS: [
    'Andijon viloyati', 'Buxoro viloyati', "Farg'ona viloyati", 'Jizzax viloyati', 'Namangan viloyati', 'Qashqadaryo viloyati',
    'Samarqand viloyati', 'Sirdaryo viloyati', 'Surxondaryo viloyati', 'Toshkent shahar', 'Toshkent viloyati', 'Xorazm viloyati',
  ],

  student: {
    title: "Engineering (Muhandislik / Texnologik tadbirlar) fanlari uchun kreativ qobiliyatlarini rivojlantirish metodikasini takomillashtirishda o'quvchilar o'rtasida o'tkaziladigan so'rovnoma",
    questions: [
      { id: 'q1', type: 'single', text: "Siz biror marta o'zingiz model yoki konstruksiya (qog'oz, karton, LEGO va boshqalardan) yasaganmisiz?",
        options: ["Ha, ko'p marta", 'Ha, bir-ikki marta', "Yo'q, lekin yasab ko'rmoqchiman", "Yo'q"] },
      { id: 'q2', type: 'single', scale: true, hint: '1 – juda past, 5 – juda yuqori',
        text: "Muhandislik fikrlashingizni (narsalar qanday ishlashini tushunish va ularni yaxshilash) qanday baholaysiz?",
        options: ['1', '2', '3', '4', '5'] },
      { id: 'q3', type: 'single', text: 'Muammoga duch kelganingizda odatda nima qilasiz?',
        options: ["O'zim yechim topishga harakat qilaman", "Do'stlarim yoki o'qituvchidan yordam so'rayman", "Internetdan qidiraman", "Tashlab qo'yaman"] },
      { id: 'q4', type: 'single', text: "Maktabda yoki to'garakda amaliy loyiha ustida ishlaganmisiz?",
        options: ['Ha, bir nechta loyihada', 'Ha, bitta loyihada', "Yo'q"] },
      { id: 'q5', type: 'single', scale: true, hint: '1 – yoqtirmayman, 3 – juda yoqtiraman',
        text: 'Jamoada ishlashni qanchalik yoqtirasiz?', options: ['1', '2', '3'] },
      { id: 'q6', type: 'multi', text: 'Qaysi materiallar bilan ishlashni yoqtirasiz? (bir nechtasini tanlash mumkin)',
        options: ["Qog'oz va karton", "Yog'och", 'Plastik va 3D bosma', 'Elektron detallar', 'Konstruktorlar (LEGO va boshqalar)'] },
      { id: 'q7', type: 'single', text: "Muhandislik darslari kelajakdagi kasb tanlashingizga ta'sir qiladimi?",
        options: ["Ha, katta ta'sir qiladi", "Biroz ta'sir qiladi", "Ta'sir qilmaydi", 'Hali bilmayman'] },
      { id: 'q8', type: 'single', scale: true, hint: "1 – qiziqmayman, 5 – juda qiziqaman",
        text: 'Robototexnikaga qiziqishingiz qanchalik?', options: ['1', '2', '3', '4', '5'] },
      { id: 'q9', type: 'single', text: "Uyda mustaqil ravishda biror narsa yasash yoki tajriba o'tkazishga qanchalik tez-tez vaqt ajratasiz?",
        options: ['Har hafta', 'Har oy', 'Kamdan-kam', 'Hech qachon'] },
      { id: 'q10', type: 'single', text: "O'zingizni ijodkor (kreativ) inson deb hisoblaysizmi?",
        options: ['Ha', 'Qisman', "Yo'q", 'Bilmayman'] },
    ],
  },

  teacher: {
    title: "Technology (Texnologiya / Informatika) fanlari uchun kreativ qobiliyatlarini rivojlantirish metodikasini takomillashtirishda o'qituvchilar o'rtasida o'tkaziladigan so'rovnoma",
    questions: [
      { id: 'q1', type: 'single', text: "Maktabingizda Texnologiya / Informatika darslari uchun zarur jihozlar (apparatura) yetarlimi?",
        options: ["Ha, to'liq yetarli", 'Qisman yetarli', "Yo'q, yetarli emas"] },
      { id: 'q2', type: 'single', text: "Darslarda qaysi o'qitish metodidan ko'proq foydalanasiz?",
        options: ["Ma'ruza", "Amaliy mashg'ulot", "Loyiha asosida o'qitish", 'Guruhda ishlash', "Interaktiv o'yinlar"] },
      { id: 'q3', type: 'single', text: "O'quvchilarning kreativ qobiliyatini qanday baholaysiz?",
        options: ['Maxsus mezonlar (rubrika) asosida', 'Loyiha natijasiga qarab', "Kuzatuv orqali", 'Baholamayman'] },
      { id: 'q4', type: 'single', text: "Darslaringizda STEAM yondashuvini (fanlararo integratsiya) qo'llaysizmi?",
        options: ['Ha, muntazam', "Ba'zan", "Yo'q"],
        extra: { key: 'q4_examples', label: 'Mavzular misoli bilan qisqacha yozing', required: false } },
      { id: 'q5', type: 'single', text: "Ochiq ta'lim resurslaridan (onlayn kurslar, video darslar, simulyatorlar) foydalanasizmi?",
        options: ['Ha, muntazam', "Ba'zan", "Yo'q"] },
      { id: 'q6', type: 'single', scale: true, hint: '1 – umuman ishonchim yo\'q, 5 – to\'liq ishonaman',
        text: "Tarmoq xavfsizligi mavzularini o'qitishda o'zingizga qanchalik ishonasiz?", options: ['1', '2', '3', '4', '5'] },
      { id: 'q7', type: 'single', text: "Qaysi ko'nikma bo'yicha malaka oshirishga eng ko'p ehtiyoj sezasiz?",
        options: ['Robototexnika', 'Dasturlash', '3D modellashtirish', 'Elektronika', 'Kiberxavfsizlik'] },
      { id: 'q8', type: 'single', text: "Qo'shimcha mablag' ajratilsa, birinchi navbatda nimaga sarflagan bo'lardingiz?",
        options: ['Jihozlar va detallar', "O'qituvchilar malakasini oshirish", 'Dasturiy ta\'minot va litsenziyalar', "O'quvchilar tanlovlari va loyihalari"] },
      { id: 'q9', type: 'single', text: "O'quvchilarning ishlari portfoliosini yuritasizmi?",
        options: ['ha', "yo'q", 'rejalashtirmoqdaman'],
        extra: { key: 'q9_format', label: 'Qanday formatda?', required: true, when: 'ha' } },
      { id: 'q10', type: 'single', scale: true, hint: '1 – muhim emas, 3 – juda muhim',
        text: "Kreativlikni rivojlantirish metodikasi bo'yicha ilmiy tadqiqotlar qanchalik muhim?", options: ['1', '2', '3'] },
    ],
  },
};
