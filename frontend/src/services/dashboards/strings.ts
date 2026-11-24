import type { ActionVerb, Lang, Localized, SpaceId, TabId } from './types';
import type { Category } from './financeApi';
import type { ProjectIconKey } from './projectIcons';
import { MANUAL_EN, MANUAL_RU, type ManualStrings } from './manualStrings';
import { RECURRING_EN, RECURRING_RU, type RecurringStrings } from './recurringStrings';

/** The page a document title is for. */
export type TitleKey = SpaceId | 'hub' | 'calendar' | 'money';

export const LANGS: readonly Lang[] = ['ru', 'en'];
export const DEFAULT_LANG: Lang = 'ru';

/** localStorage key of the dashboards' language: the only thing this feature stores. */
export const LANG_STORAGE_KEY = 'dashboards-lang';

export function isLang(value: unknown): value is Lang {
  return value === 'ru' || value === 'en';
}

/** One text in the chosen language. */
export function pick(text: Localized, lang: Lang): string {
  return text[lang];
}

/** Every fixed text of the dashboards' interface. Sample content lives in sampleData.ts. */
export interface Strings {
  readonly navLabel: string;
  /** The bar's link back to the portfolio. */
  readonly toPortfolio: string;
  /** The hub header's one-line total: '{n}' open tasks across the three spaces. */
  readonly hubTotalOpen: string;
  readonly projectsTitle: string;
  readonly newProject: string;
  /** The icon button next to Rename, the picker's label, its "none" choice, and the failure line. */
  readonly iconLabel: string;
  readonly iconPicker: string;
  readonly iconNone: string;
  readonly iconFailed: string;
  /** The bar's projects menu button and its label when the row has more projects than room. */
  readonly navProjects: string;
  readonly navProjectsMore: string;
  /** The name of each project icon, by key (the picker's radio labels). */
  readonly projectIcons: Readonly<Record<ProjectIconKey, string>>;
  readonly projectName: string;
  readonly createProject: string;
  readonly projectExists: string;
  readonly projectCreateFailed: string;
  readonly projectsFailed: string;
  readonly projectNotFound: string;
  readonly projectNotFoundText: string;
  readonly projectsNeedData: string;
  readonly backToHub: string;
  readonly renameProject: string;
  readonly renameFailed: string;
  readonly archiveProject: string;
  readonly confirmArchive: string;
  readonly archiveFailed: string;
  readonly projectNamePlaceholder: string;
  readonly dueOverdue: string;
  readonly dueToday: string;
  readonly pendingSave: string;
  readonly loading: string;
  readonly loadFailed: string;
  readonly retry: string;
  readonly notConnectedTitle: string;
  readonly notConnectedText: string;
  readonly groupPriority: string;
  readonly groupDue: string;
  readonly groupWeek: string;
  readonly groupLater: string;
  readonly groupNoDate: string;
  readonly groupDone: string;
  readonly emptyPriority: string;
  readonly emptyTasks: string;
  /** A connected source tab with nothing open. */
  readonly emptySource: string;
  /** The GitHub tab's two lists: the user's own pull requests, and those waiting for their review. */
  readonly githubMine: string;
  readonly githubReviews: string;
  /** The Linear tab's lists, by the issue's state; the backlog is behind a disclosure ("Backlog: {n}"). */
  readonly linearStarted: string;
  readonly linearTodo: string;
  readonly linearTriage: string;
  readonly linearOther: string;
  readonly linearBacklog: string;
  readonly showBacklog: string;
  /** The overview of a space with collected tasks: its lists, each naming its source, and "Show all {n}". */
  readonly overviewToday: string;
  readonly emptyToday: string;
  readonly overviewReviews: string;
  readonly overviewStarted: string;
  readonly overviewOwn: string;
  readonly showAll: string;
  readonly addTask: string;
  readonly addTaskFailed: string;
  readonly toggleFailed: string;
  readonly editTask: string;
  readonly fieldTitle: string;
  readonly fieldNotes: string;
  readonly fieldArea: string;
  readonly noArea: string;
  readonly fieldPriority: string;
  readonly fieldDue: string;
  readonly clearDue: string;
  readonly save: string;
  readonly cancel: string;
  readonly deleteTask: string;
  readonly confirmDelete: string;
  readonly saveFailed: string;
  readonly deleteFailed: string;
  readonly titleRequired: string;
  readonly allAreas: string;
  readonly areaFilter: string;
  readonly showDone: string;
  readonly summaryFailed: string;
  readonly noNextEvent: string;
  readonly newEvent: string;
  readonly evTitle: string;
  readonly evDate: string;
  readonly evStart: string;
  readonly evEnd: string;
  readonly evSpace: string;
  readonly evBusy: string;
  readonly evAdd: string;
  readonly evAdded: string;
  readonly evFailed: string;
  readonly evInvalid: string;
  readonly eventsFailed: string;
  readonly backToSite: string;
  readonly themeToLight: string;
  readonly themeToDark: string;
  /** The document title of each page, before " | <name>". */
  readonly titles: Record<TitleKey, string>;
  /** The Money page of the personal space (read-only, from the finance API). */
  readonly money: {
    readonly rec: RecurringStrings;
    readonly manual: ManualStrings;
    readonly navLink: string;
    readonly title: string;
    readonly back: string;
    readonly needsData: string;
    readonly updated: string;
    readonly totalOf: string;
    readonly inPots: string;
    readonly thisMonth: string;
    readonly spent: string;
    readonly received: string;
    readonly walletTitle: string;
    readonly walletHint: string;
    readonly walletLabel: string;
    readonly noAccounts: string;
    readonly approximately: string;
    readonly displayLabel: string;
    readonly displayBase: string;
    readonly displayNative: string;
    readonly grandTotal: string;
    readonly rateAsOf: string;
    readonly notConverted: string;
    readonly accountsFailed: string;
    readonly linkOk: string;
    readonly linkNeedsReconsent: string;
    readonly linkPaused: string;
    readonly linkNone: string;
    readonly lastOk: string;
    readonly reconnect: string;
    readonly reconnectHint: string;
    readonly ownMoney: string;
    readonly accountsTitle: string;
    readonly pots: string;
    readonly potsTotal: string;
    readonly debt: string;
    readonly overdrawn: string;
    readonly usedOfLimit: string;
    readonly usedOfOverdraft: string;
    readonly ownLimit: string;
    readonly overdraftLimit: string;
    readonly actionAccounts: string;
    readonly actionTransactions: string;
    readonly goalOf: string;
    readonly businessFold: string;
    readonly hideBusiness: string;
    readonly categories: Readonly<Record<Category, string>>;
    readonly categoryFilter: string;
    readonly allCategories: string;
    readonly incomeMonth: string;
    readonly incomeLatest: string;
    readonly incomeNone: string;
    readonly incomeFailed: string;
    readonly incomeAll: string;
    readonly spendTitle: string;
    readonly spendLess: string;
    readonly spendMore: string;
    readonly spendSame: string;
    readonly spendNothing: string;
    readonly spendFailed: string;
    readonly spendNote: string;
    readonly vsPrevious: string;
    readonly creditLimit: string;
    readonly historyFrom: string;
    readonly foldEmpty: string;
    readonly hideEmpty: string;
    readonly archivedTitle: string;
    readonly archivedMark: string;
    readonly transactionsTitle: string;
    readonly bankFilter: string;
    readonly allBanks: string;
    readonly accountFilter: string;
    readonly allAccounts: string;
    readonly search: string;
    readonly searchPlaceholder: string;
    readonly empty: string;
    readonly failed: string;
    readonly loadMore: string;
    readonly loadingMore: string;
    readonly moreFailed: string;
    readonly moneyIn: string;
    readonly moneyOut: string;
    readonly pending: string;
    readonly declined: string;
    readonly internal: string;
    readonly originalAmount: string;
  };
  /** The server did not answer (never the sample data), and the demo banner for a server with no database. */
  readonly unreachableTitle: string;
  readonly unreachableText: string;
  readonly unreachableKept: string;
  readonly sampleBanner: string;
  readonly spacesTitle: string;
  readonly noProjects: string;
  readonly nextDue: string;
  readonly githubReviewed: string;
  readonly showReviewed: string;
  readonly draftMark: string;
  readonly priorityUrgent: string;
  readonly priorityHigh: string;
  readonly navAll: string;
  readonly navCalendar: string;
  readonly langLabel: string;
  readonly hubTitle: string;
  readonly next: string;
  /** Shown in the strip after the next event: 'then 13:00 ...'. */
  readonly thenWord: string;
  /** The page footer's source-freshness prefix. */
  readonly syncedLabel: string;
  /** The strip's countdown: {n} minutes, {h} hours; whole minutes, never seconds. */
  readonly countdownNow: string;
  readonly countdownMin: string;
  readonly countdownHour: string;
  readonly countdownHourMin: string;
  readonly statOpen: string;
  readonly statPriority: string;
  readonly statOverdue: string;
  readonly join: string;
  readonly sourcesLabel: string;
  readonly priorityRow: string;
  readonly ciPass: string;
  readonly ciFail: string;
  readonly quickAdd: string;
  readonly opensInNewTab: string;
  /** The tooltip of an action that does nothing yet (sample data). */
  readonly notConnected: string;
  readonly calendarTitle: string;
  readonly calendarCaption: string;
  readonly conflicts: string;
  /** The legend's hatched swatch: a block with no details. */
  readonly busyNoDetails: string;
  readonly workdaysOnly: string;
  /** The weekend events hidden by the working-days option, with their count as '{n}'. */
  readonly weekendHidden: string;
  readonly weekendHiddenConflict: string;
  readonly showWeekend: string;
  /** The hidden events of a crowded column: '{n} more events'. */
  readonly moreEvents: string;
  readonly conflictMark: string;
  readonly viewLabel: string;
  /** The phone's strip of the week's days above the one-day grid. */
  readonly weekDaysLabel: string;
  readonly week: string;
  readonly month: string;
  readonly monthCaption: string;
  readonly periodLabel: string;
  readonly prevDay: string;
  readonly nextDay: string;
  readonly prevWeek: string;
  readonly nextWeek: string;
  readonly prevMonth: string;
  readonly nextMonth: string;
  readonly today: string;
  /** '+{n} more' under a day with more events than chips. */
  readonly more: string;
  /** A day button's name: '{date}, events: {n}'. */
  readonly dayLabel: string;
  readonly dayConflict: string;
  /** Monday first. */
  readonly weekdaysShort: readonly string[];
  /** January first, as the title of a month. */
  readonly months: readonly string[];
  /** January first, as after a day number ('23 November'). */
  readonly monthsOf: readonly string[];
  readonly tabs: Record<TabId, string>;
  readonly actions: Record<ActionVerb, string>;
}

export const STRINGS: Record<Lang, Strings> = {
  ru: {
    navLabel: 'Дашборды',
    toPortfolio: 'Портфолио',
    hubTotalOpen: 'Открыто задач: {n}',
    projectsTitle: 'Проекты',
    newProject: 'Новый проект',
    iconLabel: 'Значок',
    iconPicker: 'Значок проекта',
    iconNone: 'Без значка',
    iconFailed: 'Не удалось сохранить значок',
    navProjects: 'Проекты',
    navProjectsMore: 'Ещё проекты',
    projectIcons: {
      scales: 'Весы',
      gavel: 'Молоток судьи',
      bulb: 'Лампочка',
      spark: 'Искра',
      rocket: 'Ракета',
      home: 'Дом',
      heart: 'Сердце',
      book: 'Книга',
      briefcase: 'Портфель',
      globe: 'Глобус',
      camera: 'Камера',
      code: 'Код',
      wallet: 'Кошелёк',
      plane: 'Самолёт',
      leaf: 'Лист',
      flag: 'Флаг',
      star: 'Звезда',
      shield: 'Щит',
    },
    projectName: 'Название проекта',
    createProject: 'Создать',
    projectExists: 'Проект с таким названием уже есть.',
    projectCreateFailed: 'Не удалось создать проект. Повторите.',
    projectsFailed: 'Не удалось загрузить проекты.',
    projectNotFound: 'Проект не найден',
    projectNotFoundText: 'Такого проекта нет, или он в архиве.',
    projectsNeedData: 'Проекты доступны только на реальных данных.',
    backToHub: 'К дашбордам',
    renameProject: 'Переименовать',
    renameFailed: 'Не удалось переименовать. Повторите.',
    archiveProject: 'В архив',
    confirmArchive: 'Подтвердить архивацию',
    archiveFailed: 'Не удалось архивировать. Повторите.',
    projectNamePlaceholder: 'Например, «Сад»',
    dueOverdue: 'просрочено',
    dueToday: 'сегодня',
    pendingSave: 'Сохраняется…',
    loading: 'Загрузка…',
    loadFailed: 'Не удалось загрузить.',
    retry: 'Повторить',
    notConnectedTitle: 'Пока не подключено',
    notConnectedText: 'Этот источник ещё не подключён к дашбордам: здесь появятся его данные. Пока рабочая поверхность — задачи и календарь.',
    groupPriority: 'Приоритет',
    groupDue: 'Сегодня и просрочено',
    groupWeek: 'На этой неделе',
    groupLater: 'Позже',
    groupNoDate: 'Без даты',
    groupDone: 'Готово',
    emptyPriority: 'Приоритетных задач нет',
    emptyTasks: 'Задач пока нет. Добавьте первую в поле выше.',
    emptySource: 'Открытого здесь нет',
    githubMine: 'Мои PR',
    githubReviews: 'Ждут моего ревью',
    linearStarted: 'В работе',
    linearTodo: 'К выполнению',
    linearTriage: 'На разборе',
    linearOther: 'Прочее',
    linearBacklog: 'Бэклог',
    showBacklog: 'Бэклог: {n}',
    overviewToday: 'Встречи сегодня · календарь',
    emptyToday: 'Встреч сегодня нет',
    overviewReviews: 'Ждут моего ревью · GitHub',
    overviewStarted: 'В работе · Linear',
    overviewOwn: 'Мои заметки и задачи',
    showAll: 'Показать все: {n}',
    addTask: 'Добавить задачу',
    addTaskFailed: 'Не удалось добавить задачу. Повторите.',
    toggleFailed: 'Не удалось сохранить: задача возвращена как была.',
    editTask: 'Изменить',
    fieldTitle: 'Название',
    fieldNotes: 'Заметки',
    fieldArea: 'Сфера',
    noArea: 'Без сферы',
    fieldPriority: 'Приоритет',
    fieldDue: 'Срок',
    clearDue: 'Убрать срок',
    save: 'Сохранить',
    cancel: 'Отмена',
    deleteTask: 'Удалить',
    confirmDelete: 'Подтвердить удаление',
    saveFailed: 'Не удалось сохранить. Повторите.',
    deleteFailed: 'Не удалось удалить. Повторите.',
    titleRequired: 'Укажите название.',
    allAreas: 'Все сферы',
    areaFilter: 'Фильтр по сфере',
    showDone: 'Готово: {n}',
    summaryFailed: 'Не удалось загрузить сводку.',
    noNextEvent: 'Ближайших событий нет',
    newEvent: 'Новое событие',
    evTitle: 'Название',
    evDate: 'Дата',
    evStart: 'Начало',
    evEnd: 'Конец',
    evSpace: 'Пространство',
    evBusy: 'Показывать в других пространствах как «Фокус-время»',
    evAdd: 'Добавить событие',
    evAdded: 'Событие добавлено',
    evFailed: 'Не удалось добавить событие. Повторите.',
    evInvalid: 'Конец должен быть позже начала.',
    eventsFailed: 'Не удалось загрузить события.',
    backToSite: 'yuriodev: на сайт',
    themeToLight: 'Включить светлую тему',
    themeToDark: 'Включить тёмную тему',
    titles: { hub: 'Дашборды', personal: 'Личное', 'work-1': 'Работа 1', 'work-2': 'Работа 2', calendar: 'Календарь', money: 'Деньги' },
    money: {
      rec: RECURRING_RU,
      manual: MANUAL_RU,
      navLink: 'Деньги',
      title: 'Деньги',
      back: 'К личному',
      needsData: 'Деньги доступны только на реальных данных.',
      updated: 'обновлено {when}',
      totalOf: '{currency} · счетов: {n}',
      inPots: 'из них в копилках {amount}',
      thisMonth: 'в этом месяце',
      spent: 'потрачено',
      received: 'получено',
      walletTitle: 'Кошелёк',
      walletHint: 'все банки стопкой, выберите банк',
      walletLabel: 'Банки',
      noAccounts: 'Счетов пока нет.',
      approximately: 'примерно',
      displayLabel: 'Суммы',
      displayBase: 'в фунтах',
      displayNative: 'в валюте счёта',
      grandTotal: 'всего',
      rateAsOf: 'курс на {when}',
      notConverted: 'без пересчёта: {list}',
      accountsFailed: 'Не удалось загрузить счета.',
      linkOk: 'подключено',
      linkNeedsReconsent: 'нужно переподключить',
      linkPaused: 'приостановлено',
      linkNone: 'нет подключения',
      lastOk: 'обновлено {when}',
      reconnect: 'Переподключить',
      reconnectHint: 'Банк просит подтвердить доступ заново. Данные не обновляются, пока это не сделано.',
      ownMoney: 'своих денег',
      accountsTitle: 'Счета',
      pots: 'Копилки',
      potsTotal: '{n} · всего {amount}',
      debt: 'долг',
      overdrawn: 'овердрафт',
      usedOfLimit: 'занято {percent}% лимита {limit} · свободно {free}',
      usedOfOverdraft: 'занято {percent}% овердрафта {limit} · свободно {free}',
      ownLimit: 'ваш лимит',
      overdraftLimit: 'овердрафт {amount}',
      actionAccounts: 'Счета',
      actionTransactions: 'Операции',
      goalOf: '{percent}% от цели {goal}',
      businessFold: 'Бизнес-счета: {n}',
      hideBusiness: 'Скрыть бизнес-счета',
      categories: {
        housing_utilities: 'Жильё и коммунальные',
        groceries: 'Продукты',
        eating_out: 'Кафе и рестораны',
        transport: 'Транспорт',
        subscriptions: 'Подписки',
        health: 'Здоровье',
        shopping: 'Покупки',
        entertainment: 'Развлечения',
        debt: 'Долги и кредиты',
        income: 'Доходы',
        transfers: 'Между своими счетами',
        transfers_out: 'Переводы людям',
        cash: 'Наличные',
        other: 'Прочее',
      },
      categoryFilter: 'Категория',
      allCategories: 'Все категории',
      incomeMonth: 'Доход в этом месяце',
      incomeLatest: 'Последние поступления',
      incomeNone: 'Поступлений пока нет.',
      incomeFailed: 'Не удалось загрузить доходы.',
      incomeAll: 'Все операции в «Деньги»',
      spendTitle: 'Траты по категориям',
      spendLess: 'на {percent}% меньше, чем за {previous}',
      spendMore: 'на {percent}% больше, чем за {previous}',
      spendSame: 'как за {previous}',
      spendNothing: 'Трат в этом месяце пока нет.',
      spendFailed: 'Не удалось загрузить траты по категориям.',
      spendNote: 'Переводы между своими счетами и копилками в траты не входят.',
      vsPrevious: 'было {amount}',
      creditLimit: 'лимит {amount}',
      historyFrom: 'история с {date}',
      foldEmpty: 'Ещё пустых: {n}',
      hideEmpty: 'Скрыть пустые',
      archivedTitle: 'В архиве',
      archivedMark: 'в архиве',
      transactionsTitle: 'Операции',
      bankFilter: 'Банк',
      allBanks: 'Все банки',
      accountFilter: 'Счёт',
      allAccounts: 'Все счета',
      search: 'Поиск по операциям',
      searchPlaceholder: 'Описание или получатель',
      empty: 'Операций не найдено.',
      failed: 'Не удалось загрузить операции.',
      loadMore: 'Загрузить ещё',
      loadingMore: 'Загрузка…',
      moreFailed: 'Не удалось загрузить ещё.',
      moneyIn: 'Поступление',
      moneyOut: 'Списание',
      pending: 'в обработке',
      declined: 'отклонено',
      internal: 'между своими счетами',
      originalAmount: 'в оригинале {amount}',
    },
    unreachableTitle: 'Нет связи с сервером',
    unreachableText: 'Панель не получила ответа, поэтому ничего не показывает: примерные данные здесь не подставляются. Попробуйте ещё раз через минуту.',
    unreachableKept: 'Названия и проекты в верхней панели взяты из последнего сеанса и могут быть устаревшими.',
    sampleBanner: 'Демо: примерные данные, сервер данных не подключён.',
    spacesTitle: 'Пространства',
    noProjects: 'Проектов пока нет.',
    nextDue: 'ближайший срок {date}',
    githubReviewed: 'Просмотрено мной, ещё открыто',
    showReviewed: 'Просмотрено мной: {n}',
    draftMark: 'черновик',
    priorityUrgent: 'срочно',
    priorityHigh: 'высокий',
    navAll: 'Все',
    navCalendar: 'Календарь',
    langLabel: 'Язык',
    hubTitle: 'Дашборды',
    next: 'Дальше',
    thenWord: 'затем',
    syncedLabel: 'Синхр.:',
    countdownNow: 'сейчас',
    countdownMin: 'через {n} мин',
    countdownHour: 'через {h} ч',
    countdownHourMin: 'через {h} ч {m} мин',
    statOpen: 'открыто',
    statPriority: 'приоритет',
    statOverdue: 'просрочено',
    join: 'Подключиться',
    sourcesLabel: 'Источники',
    priorityRow: 'Приоритет',
    ciPass: 'CI проходит',
    ciFail: 'CI падает',
    quickAdd: 'Быстрое добавление',
    opensInNewTab: 'откроется в новой вкладке',
    notConnected: 'Пример: источник не подключён',
    calendarTitle: 'Календарь',
    calendarCaption: 'Неделя, события трёх пространств',
    conflicts: 'Конфликты',
    busyNoDetails: 'Занято, без деталей',
    workdaysOnly: 'Показывать только рабочие дни',
    weekendHidden: 'Скрыто событий в выходные: {n}.',
    weekendHiddenConflict: 'Среди них есть конфликт.',
    showWeekend: 'Показать выходные',
    moreEvents: 'Ещё событий: {n}',
    conflictMark: 'Конфликт: пересекается с событием другого пространства',
    viewLabel: 'Вид',
    weekDaysLabel: 'Дни недели',
    week: 'Неделя',
    month: 'Месяц',
    monthCaption: 'Месяц, события трёх пространств',
    periodLabel: 'Период',
    prevDay: 'Предыдущий день',
    nextDay: 'Следующий день',
    prevWeek: 'Предыдущая неделя',
    nextWeek: 'Следующая неделя',
    prevMonth: 'Предыдущий месяц',
    nextMonth: 'Следующий месяц',
    today: 'Сегодня',
    more: '+{n} ещё',
    dayLabel: '{date}, событий: {n}',
    dayConflict: 'есть конфликт',
    weekdaysShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    monthsOf: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    tabs: {
      overview: 'Обзор',
      areas: 'Сферы',
      payments: 'Платежи',
      work: 'Работа и доход',
      mail: 'Почта',
      telegram: 'Telegram',
      github: 'GitHub',
      linear: 'Linear',
      slack: 'Slack',
      notion: 'Notion',
      posthog: 'PostHog',
      grafana: 'Grafana',
      meetings: 'Встречи',
      jira: 'Jira',
      teams: 'Teams',
    },
    actions: { reply: 'Ответить', ask: 'Спросить', open: 'Открыть', restore: 'Вернуть' },
  },
  en: {
    navLabel: 'Dashboards',
    toPortfolio: 'Portfolio',
    hubTotalOpen: 'Open tasks: {n}',
    projectsTitle: 'Projects',
    newProject: 'New project',
    iconLabel: 'Icon',
    iconPicker: 'Project icon',
    iconNone: 'No icon',
    iconFailed: 'Could not save the icon',
    navProjects: 'Projects',
    navProjectsMore: 'More projects',
    projectIcons: {
      scales: 'Scales',
      gavel: 'Gavel',
      bulb: 'Light bulb',
      spark: 'Spark',
      rocket: 'Rocket',
      home: 'Home',
      heart: 'Heart',
      book: 'Book',
      briefcase: 'Briefcase',
      globe: 'Globe',
      camera: 'Camera',
      code: 'Code',
      wallet: 'Wallet',
      plane: 'Plane',
      leaf: 'Leaf',
      flag: 'Flag',
      star: 'Star',
      shield: 'Shield',
    },
    projectName: 'Project name',
    createProject: 'Create',
    projectExists: 'A project with this name already exists.',
    projectCreateFailed: 'Could not create the project. Try again.',
    projectsFailed: 'Could not load the projects.',
    projectNotFound: 'Project not found',
    projectNotFoundText: 'There is no such project, or it is archived.',
    projectsNeedData: 'Projects need the live data.',
    backToHub: 'Back to the dashboards',
    renameProject: 'Rename',
    renameFailed: 'Could not rename. Try again.',
    archiveProject: 'Archive',
    confirmArchive: 'Confirm archive',
    archiveFailed: 'Could not archive. Try again.',
    projectNamePlaceholder: 'For example, Garden',
    dueOverdue: 'overdue',
    dueToday: 'today',
    pendingSave: 'Saving…',
    loading: 'Loading…',
    loadFailed: 'Could not load this.',
    retry: 'Try again',
    notConnectedTitle: 'Not connected yet',
    notConnectedText: 'This source is not connected to the dashboards yet; its data will appear here. For now the working surface is tasks and the calendar.',
    groupPriority: 'Priority',
    groupDue: 'Due and overdue',
    groupWeek: 'This week',
    groupLater: 'Later',
    groupNoDate: 'No date',
    groupDone: 'Done',
    emptyPriority: 'Nothing prioritised',
    emptyTasks: 'No tasks yet. Add the first one in the field above.',
    emptySource: 'Nothing open here',
    githubMine: 'My pull requests',
    githubReviews: 'Waiting for my review',
    linearStarted: 'In progress',
    linearTodo: 'Todo',
    linearTriage: 'Triage',
    linearOther: 'Other',
    linearBacklog: 'Backlog',
    showBacklog: 'Backlog: {n}',
    overviewToday: 'Meetings today · calendar',
    emptyToday: 'No meetings today',
    overviewReviews: 'Waiting for my review · GitHub',
    overviewStarted: 'In progress · Linear',
    overviewOwn: 'My notes and tasks',
    showAll: 'Show all: {n}',
    addTask: 'Add a task',
    addTaskFailed: 'Could not add the task. Try again.',
    toggleFailed: 'Could not save: the task is back as it was.',
    editTask: 'Edit',
    fieldTitle: 'Title',
    fieldNotes: 'Notes',
    fieldArea: 'Area',
    noArea: 'No area',
    fieldPriority: 'Priority',
    fieldDue: 'Due date',
    clearDue: 'Clear the date',
    save: 'Save',
    cancel: 'Cancel',
    deleteTask: 'Delete',
    confirmDelete: 'Confirm delete',
    saveFailed: 'Could not save. Try again.',
    deleteFailed: 'Could not delete. Try again.',
    titleRequired: 'Enter a title.',
    allAreas: 'All areas',
    areaFilter: 'Filter by area',
    showDone: 'Done: {n}',
    summaryFailed: 'Could not load the summary.',
    noNextEvent: 'No upcoming events',
    newEvent: 'New event',
    evTitle: 'Title',
    evDate: 'Date',
    evStart: 'Start',
    evEnd: 'End',
    evSpace: 'Space',
    evBusy: 'Show in the other spaces as Focus time',
    evAdd: 'Add event',
    evAdded: 'Event added',
    evFailed: 'Could not add the event. Try again.',
    evInvalid: 'The end must be after the start.',
    eventsFailed: 'Could not load the events.',
    backToSite: 'yuriodev: back to the site',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
    titles: { hub: 'Dashboards', personal: 'Personal', 'work-1': 'Work 1', 'work-2': 'Work 2', calendar: 'Calendar', money: 'Money' },
    money: {
      rec: RECURRING_EN,
      manual: MANUAL_EN,
      navLink: 'Money',
      title: 'Money',
      back: 'Back to Personal',
      needsData: 'Money needs the live data.',
      updated: 'updated {when}',
      totalOf: '{currency} · accounts: {n}',
      inPots: 'of which in pots {amount}',
      thisMonth: 'this month',
      spent: 'spent',
      received: 'received',
      walletTitle: 'Wallet',
      walletHint: 'every bank in a stack, pick one',
      walletLabel: 'Banks',
      noAccounts: 'No accounts yet.',
      approximately: 'approximately',
      displayLabel: 'Amounts',
      displayBase: 'in pounds',
      displayNative: 'in account currency',
      grandTotal: 'in all',
      rateAsOf: 'rate as of {when}',
      notConverted: 'not converted: {list}',
      accountsFailed: 'Could not load the accounts.',
      linkOk: 'connected',
      linkNeedsReconsent: 'needs reconnecting',
      linkPaused: 'paused',
      linkNone: 'no connection',
      lastOk: 'updated {when}',
      reconnect: 'Reconnect',
      reconnectHint: 'The bank asks you to confirm access again. Nothing updates until you do.',
      ownMoney: 'own money',
      accountsTitle: 'Accounts',
      pots: 'Pots',
      potsTotal: '{n} · {amount} in all',
      debt: 'debt',
      overdrawn: 'overdrawn',
      usedOfLimit: '{percent}% of the {limit} limit used · {free} free',
      usedOfOverdraft: '{percent}% of the {limit} overdraft used · {free} free',
      ownLimit: 'your limit',
      overdraftLimit: '{amount} overdraft limit',
      actionAccounts: 'Accounts',
      actionTransactions: 'Transactions',
      goalOf: '{percent}% of the {goal} goal',
      businessFold: 'Business accounts: {n}',
      hideBusiness: 'Hide business accounts',
      categories: {
        housing_utilities: 'Housing and utilities',
        groceries: 'Groceries',
        eating_out: 'Eating out',
        transport: 'Transport',
        subscriptions: 'Subscriptions',
        health: 'Health',
        shopping: 'Shopping',
        entertainment: 'Entertainment',
        debt: 'Debt and loans',
        income: 'Income',
        transfers: 'Between own accounts',
        transfers_out: 'Transfers to people',
        cash: 'Cash',
        other: 'Other',
      },
      categoryFilter: 'Category',
      allCategories: 'All categories',
      incomeMonth: 'Income this month',
      incomeLatest: 'Latest incoming',
      incomeNone: 'No income yet.',
      incomeFailed: 'Could not load the income.',
      incomeAll: 'All transactions in Money',
      spendTitle: 'Spend by category',
      spendLess: '{percent}% less than {previous}',
      spendMore: '{percent}% more than {previous}',
      spendSame: 'same as {previous}',
      spendNothing: 'No spending this month yet.',
      spendFailed: 'Could not load spending by category.',
      spendNote: 'Transfers between your own accounts and pots are not counted as spending.',
      vsPrevious: 'was {amount}',
      creditLimit: 'limit {amount}',
      historyFrom: 'history from {date}',
      foldEmpty: '{n} more empty',
      hideEmpty: 'Hide the empty ones',
      archivedTitle: 'Archived',
      archivedMark: 'archived',
      transactionsTitle: 'Transactions',
      bankFilter: 'Bank',
      allBanks: 'All banks',
      accountFilter: 'Account',
      allAccounts: 'All accounts',
      search: 'Search transactions',
      searchPlaceholder: 'Description or payee',
      empty: 'No transactions found.',
      failed: 'Could not load the transactions.',
      loadMore: 'Load more',
      loadingMore: 'Loading…',
      moreFailed: 'Could not load more.',
      moneyIn: 'Money in',
      moneyOut: 'Money out',
      pending: 'pending',
      declined: 'declined',
      internal: 'between your accounts',
      originalAmount: 'originally {amount}',
    },
    unreachableTitle: 'Cannot reach the server',
    unreachableText: 'The dashboards got no answer, so they show nothing: sample data is never put in its place. Try again in a minute.',
    unreachableKept: 'The names and projects in the bar come from the last visit and may be out of date.',
    sampleBanner: 'Demo: sample data, no data server is connected.',
    spacesTitle: 'Spaces',
    noProjects: 'No projects yet.',
    nextDue: 'next due {date}',
    githubReviewed: 'Reviewed by me, still open',
    showReviewed: 'Reviewed by me: {n}',
    draftMark: 'draft',
    priorityUrgent: 'urgent',
    priorityHigh: 'high',
    navAll: 'All',
    navCalendar: 'Calendar',
    langLabel: 'Language',
    hubTitle: 'Dashboards',
    next: 'Next',
    thenWord: 'then',
    syncedLabel: 'Synced:',
    countdownNow: 'now',
    countdownMin: 'in {n} min',
    countdownHour: 'in {h} h',
    countdownHourMin: 'in {h} h {m} min',
    statOpen: 'open',
    statPriority: 'priority',
    statOverdue: 'overdue',
    join: 'Join',
    sourcesLabel: 'Sources',
    priorityRow: 'Priority',
    ciPass: 'CI passing',
    ciFail: 'CI failing',
    quickAdd: 'Quick add',
    opensInNewTab: 'opens in a new tab',
    notConnected: 'Sample: the source is not connected',
    calendarTitle: 'Calendar',
    calendarCaption: 'Week, events of all three spaces',
    conflicts: 'Conflicts',
    busyNoDetails: 'Busy, no details',
    workdaysOnly: 'Show working days only',
    weekendHidden: 'Weekend events hidden: {n}.',
    weekendHiddenConflict: 'They include a conflict.',
    showWeekend: 'Show weekends',
    moreEvents: '{n} more events',
    conflictMark: 'Conflict: overlaps an event of another space',
    viewLabel: 'View',
    weekDaysLabel: 'Days of the week',
    week: 'Week',
    month: 'Month',
    monthCaption: 'Month, events of all three spaces',
    periodLabel: 'Period',
    prevDay: 'Previous day',
    nextDay: 'Next day',
    prevWeek: 'Previous week',
    nextWeek: 'Next week',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    today: 'Today',
    more: '+{n} more',
    dayLabel: '{date}, events: {n}',
    dayConflict: 'has a conflict',
    weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    monthsOf: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    tabs: {
      overview: 'Overview',
      areas: 'Life areas',
      payments: 'Payments',
      work: 'Work and income',
      mail: 'Mail',
      telegram: 'Telegram',
      github: 'GitHub',
      linear: 'Linear',
      slack: 'Slack',
      notion: 'Notion',
      posthog: 'PostHog',
      grafana: 'Grafana',
      meetings: 'Meetings',
      jira: 'Jira',
      teams: 'Teams',
    },
    actions: { reply: 'Reply', ask: 'Ask', open: 'Open', restore: 'Restore' },
  },
};
