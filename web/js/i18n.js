// Interface (UI chrome) translations. Entity content (names, descriptions,
// schedules as scraped) is NOT translated here — see CONTRACT.md §10.
// `UI[lang]` covers everything the chrome renders; `ROLES`/`MTYPES` cover
// the two small vocab tables used inside entity popups (artist role,
// music-credit type). Weekday/month/date formatting is derived per-locale
// via Intl in logic.js — not duplicated here.

export const LANG_META = [
  { code: 'EN', label: 'English', native: 'English' },
  { code: 'DE', label: 'German', native: 'Deutsch' },
  { code: 'ES', label: 'Spanish (Latin America)', native: 'Español' },
  { code: 'PT', label: 'Portuguese', native: 'Português' },
  { code: 'IT', label: 'Italian', native: 'Italiano' },
  { code: 'RU', label: 'Russian', native: 'Русский' },
  { code: 'UK', label: 'Ukrainian', native: 'Українська' },
  { code: 'ZH', label: 'Chinese', native: '中文' },
  { code: 'JA', label: 'Japanese', native: '日本語' },
  { code: 'KO', label: 'Korean', native: '한국어' },
  { code: 'FR', label: 'French', native: 'Français' },
];

export const LANG_CODES = LANG_META.map((l) => l.code);

export const DEFAULT_LANG = 'EN';

export const UI = {
  EN: { locale: 'en-GB', today: 'Today', music: 'Music', organizedBy: 'Organized by', artists: 'Artists', from: 'From', until: 'Until',
    links: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', email: 'Email' },
    dances: { tango: 'Tango', salsa: 'Salsa', bachata: 'Bachata', kizomba: 'Kizomba' },
    cats: { social: { tango: 'Milongas', default: 'Socials' }, marathon: 'Marathons', festival: 'Festivals', class: 'Classes' },
    clearDatesAria: 'Clear selected dates',
    dateCount: { one: '{n} date', other: '{n} dates' },
    dataUpdated: 'data updated {date}' },
  DE: { locale: 'de', today: 'Heute', music: 'Musik', organizedBy: 'Veranstaltet von', artists: 'Künstler', from: 'Ab', until: 'Bis',
    links: { website: 'Webseite', facebook: 'Facebook', instagram: 'Instagram', email: 'E-Mail' },
    dances: { tango: 'Tango', salsa: 'Salsa', bachata: 'Bachata', kizomba: 'Kizomba' },
    cats: { social: { tango: 'Milongas', default: 'Socials' }, marathon: 'Marathons', festival: 'Festivals', class: 'Kurse' },
    clearDatesAria: 'Ausgewählte Termine löschen',
    dateCount: { one: '{n} Termin', other: '{n} Termine' },
    dataUpdated: 'Daten aktualisiert am {date}' },
  ES: { locale: 'es-419', today: 'Hoy', music: 'Música', organizedBy: 'Organizado por', artists: 'Artistas', from: 'Desde', until: 'Hasta',
    links: { website: 'Sitio web', facebook: 'Facebook', instagram: 'Instagram', email: 'Correo' },
    dances: { tango: 'Tango', salsa: 'Salsa', bachata: 'Bachata', kizomba: 'Kizomba' },
    cats: { social: { tango: 'Milongas', default: 'Sociales' }, marathon: 'Maratones', festival: 'Festivales', class: 'Clases' },
    clearDatesAria: 'Borrar fechas seleccionadas',
    dateCount: { one: '{n} fecha', other: '{n} fechas' },
    dataUpdated: 'datos actualizados el {date}' },
  PT: { locale: 'pt', today: 'Hoje', music: 'Música', organizedBy: 'Organizado por', artists: 'Artistas', from: 'A partir de', until: 'Até',
    links: { website: 'Site', facebook: 'Facebook', instagram: 'Instagram', email: 'E-mail' },
    dances: { tango: 'Tango', salsa: 'Salsa', bachata: 'Bachata', kizomba: 'Kizomba' },
    cats: { social: { tango: 'Milongas', default: 'Sociais' }, marathon: 'Maratonas', festival: 'Festivais', class: 'Aulas' },
    clearDatesAria: 'Limpar datas selecionadas',
    dateCount: { one: '{n} data', other: '{n} datas' },
    dataUpdated: 'dados atualizados em {date}' },
  IT: { locale: 'it', today: 'Oggi', music: 'Musica', organizedBy: 'Organizzato da', artists: 'Artisti', from: 'Dal', until: 'Fino al',
    links: { website: 'Sito web', facebook: 'Facebook', instagram: 'Instagram', email: 'E-mail' },
    dances: { tango: 'Tango', salsa: 'Salsa', bachata: 'Bachata', kizomba: 'Kizomba' },
    cats: { social: { tango: 'Milonghe', default: 'Serate' }, marathon: 'Maratone', festival: 'Festival', class: 'Corsi' },
    clearDatesAria: 'Cancella date selezionate',
    dateCount: { one: '{n} data', other: '{n} date' },
    dataUpdated: 'dati aggiornati il {date}' },
  RU: { locale: 'ru', today: 'Сегодня', music: 'Музыка', organizedBy: 'Организатор', artists: 'Артисты', from: 'С', until: 'До',
    links: { website: 'Сайт', facebook: 'Facebook', instagram: 'Instagram', email: 'Эл. почта' },
    dances: { tango: 'Танго', salsa: 'Сальса', bachata: 'Бачата', kizomba: 'Кизомба' },
    cats: { social: { tango: 'Милонги', default: 'Вечеринки' }, marathon: 'Марафоны', festival: 'Фестивали', class: 'Занятия' },
    clearDatesAria: 'Очистить выбранные даты',
    dateCount: { one: '{n} дата', few: '{n} даты', many: '{n} дат', other: '{n} даты' },
    dataUpdated: 'данные обновлены {date}' },
  UK: { locale: 'uk', today: 'Сьогодні', music: 'Музика', organizedBy: 'Організатор', artists: 'Артисти', from: 'З', until: 'До',
    links: { website: 'Сайт', facebook: 'Facebook', instagram: 'Instagram', email: 'Ел. пошта' },
    dances: { tango: 'Танго', salsa: 'Сальса', bachata: 'Бачата', kizomba: 'Кізомба' },
    cats: { social: { tango: 'Мілонги', default: 'Вечірки' }, marathon: 'Марафони', festival: 'Фестивалі', class: 'Заняття' },
    clearDatesAria: 'Очистити вибрані дати',
    dateCount: { one: '{n} дата', few: '{n} дати', many: '{n} дат', other: '{n} дати' },
    dataUpdated: 'дані оновлено {date}' },
  ZH: { locale: 'zh', today: '今天', music: '音乐', organizedBy: '主办', artists: '艺术家', from: '自', until: '至',
    links: { website: '网站', facebook: 'Facebook', instagram: 'Instagram', email: '邮箱' },
    dances: { tango: '探戈', salsa: '萨尔萨', bachata: '巴恰塔', kizomba: '基宗巴' },
    cats: { social: { tango: '米隆加', default: '舞会' }, marathon: '马拉松', festival: '节日', class: '课程' },
    clearDatesAria: '清除所选日期',
    dateCount: { other: '已选 {n} 个日期' },
    dataUpdated: '数据更新于 {date}' },
  JA: { locale: 'ja', today: '今日', music: '音楽', organizedBy: '主催', artists: 'アーティスト', from: '開始', until: '終了',
    links: { website: 'ウェブサイト', facebook: 'Facebook', instagram: 'Instagram', email: 'メール' },
    dances: { tango: 'タンゴ', salsa: 'サルサ', bachata: 'バチャータ', kizomba: 'キゾンバ' },
    cats: { social: { tango: 'ミロンガ', default: 'ソーシャル' }, marathon: 'マラソン', festival: 'フェスティバル', class: 'クラス' },
    clearDatesAria: '選択した日付をクリア',
    dateCount: { other: '{n} 件の日付' },
    dataUpdated: 'データ更新: {date}' },
  KO: { locale: 'ko', today: '오늘', music: '음악', organizedBy: '주최', artists: '아티스트', from: '시작', until: '종료',
    links: { website: '웹사이트', facebook: 'Facebook', instagram: 'Instagram', email: '이메일' },
    dances: { tango: '탱고', salsa: '살사', bachata: '바차타', kizomba: '키좀바' },
    cats: { social: { tango: '밀롱가', default: '소셜' }, marathon: '마라톤', festival: '페스티벌', class: '클래스' },
    clearDatesAria: '선택한 날짜 지우기',
    dateCount: { other: '{n}개 날짜' },
    dataUpdated: '데이터 업데이트: {date}' },
  FR: { locale: 'fr', today: "Aujourd'hui", music: 'Musique', organizedBy: 'Organisé par', artists: 'Artistes', from: 'À partir du', until: "Jusqu'au",
    links: { website: 'Site web', facebook: 'Facebook', instagram: 'Instagram', email: 'E-mail' },
    dances: { tango: 'Tango', salsa: 'Salsa', bachata: 'Bachata', kizomba: 'Kizomba' },
    cats: { social: { tango: 'Milongas', default: 'Soirées' }, marathon: 'Marathons', festival: 'Festivals', class: 'Cours' },
    clearDatesAria: 'Effacer les dates sélectionnées',
    dateCount: { one: '{n} date', other: '{n} dates' },
    dataUpdated: 'données mises à jour le {date}' },
};

export const ROLES = {
  EN: { teacher: 'teacher', performer: 'performer' },
  DE: { teacher: 'Lehrer', performer: 'Tänzer' },
  ES: { teacher: 'profesor', performer: 'bailarín' },
  PT: { teacher: 'professor', performer: 'bailarino' },
  IT: { teacher: 'insegnante', performer: 'ballerino' },
  RU: { teacher: 'преподаватель', performer: 'исполнитель' },
  UK: { teacher: 'викладач', performer: 'виконавець' },
  ZH: { teacher: '老师', performer: '表演者' },
  JA: { teacher: '講師', performer: 'パフォーマー' },
  KO: { teacher: '강사', performer: '퍼포머' },
  FR: { teacher: 'professeur', performer: 'danseur' },
};

export const MTYPES = {
  EN: { dj: 'DJ', orchestra: 'orchestra', band: 'band' },
  DE: { dj: 'DJ', orchestra: 'Orchester', band: 'Band' },
  ES: { dj: 'DJ', orchestra: 'orquesta', band: 'banda' },
  PT: { dj: 'DJ', orchestra: 'orquestra', band: 'banda' },
  IT: { dj: 'DJ', orchestra: 'orchestra', band: 'band' },
  RU: { dj: 'DJ', orchestra: 'оркестр', band: 'группа' },
  UK: { dj: 'DJ', orchestra: 'оркестр', band: 'гурт' },
  ZH: { dj: 'DJ', orchestra: '乐团', band: '乐队' },
  JA: { dj: 'DJ', orchestra: 'オーケストラ', band: 'バンド' },
  KO: { dj: 'DJ', orchestra: '오케스트라', band: '밴드' },
  FR: { dj: 'DJ', orchestra: 'orchestre', band: 'groupe' },
};

/** Resolve the active language at load time: hash wins over localStorage wins over default. */
export function resolveLang(hashLang, storedLang) {
  const hash = String(hashLang ?? '').toUpperCase();
  const stored = String(storedLang ?? '').toUpperCase();
  if (LANG_CODES.includes(hash)) return hash;
  if (LANG_CODES.includes(stored)) return stored;
  return DEFAULT_LANG;
}

/** Extract the lang code from a '#lang=<code>' hash fragment; null when absent. */
export function parseLangHash(hash) {
  const match = /(?:^|[#&])lang=([a-zA-Z]+)/.exec(String(hash ?? ''));
  return match ? match[1].toUpperCase() : null;
}
