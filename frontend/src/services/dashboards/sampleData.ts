import type {
  ActionVerb,
  Due,
  DueTone,
  InfoRow,
  Localized,
  Panel,
  PullRequestRow,
  Row,
  RowAction,
  SpaceData,
  SpaceId,
  TabId,
  TaskRow,
  WeekData,
  WeekEvent,
} from './types';

/*
 * Generic sample content for every panel and row type, in both languages.
 * Nothing here is real: names, numbers, PRs and amounts are placeholders.
 * A later API call replaces this module's output (see source.ts).
 */

const L = (ru: string, en: string): Localized => ({ ru, en });

const TODAY = L('сегодня', 'today');
const OVERDUE = L('просрочено', 'overdue');

const due = (label: Localized, tone: DueTone = 'neutral'): Due => ({ label, tone });
const act = (tool: TabId, verb: ActionVerb = 'reply', href?: string): RowAction => ({ tool, verb, href });

type Extra = Partial<Omit<TaskRow, 'kind' | 'id' | 'title'>>;

const task = (id: string, title: Localized, extra: Extra = {}): TaskRow => ({ kind: 'task', id, title, ...extra });
const info = (id: string, title: Localized, extra: Partial<Omit<InfoRow, 'kind' | 'id' | 'title'>> = {}): InfoRow => ({
  kind: 'info',
  id,
  title,
  ...extra,
});
const pr = (
  id: string,
  ref: string,
  title: Localized,
  ci: PullRequestRow['ci'],
  extra: Partial<Omit<PullRequestRow, 'kind' | 'id' | 'title' | 'ref' | 'ci'>> = {},
): PullRequestRow => ({
  kind: 'pr',
  id,
  ref,
  refHref: `https://github.com/example/repo/pull/${ref.slice(1)}`,
  title,
  ci,
  ...extra,
});

const panel = (
  id: string,
  tab: TabId,
  title: Localized,
  rows: readonly Row[],
  extra: Partial<Omit<Panel, 'id' | 'tab' | 'title' | 'rows'>> = {},
): Panel => ({ id, tab, title, rows, ...extra });

const PERSONAL: SpaceData = {
  id: 'personal',
  about: L(
    'Жизнь по сферам: деньги, здоровье, бумаги, отношения, семья, дом.',
    'Life by area: money, health, paperwork, relationships, family, home.',
  ),
  quickAddPlaceholder: L('добавить личную задачу… «завтра позвонить в клинику»', 'add a personal task… "call the clinic tomorrow"'),
  hero: {
    label: L('ДАЛЬШЕ СЕГОДНЯ', 'NEXT TODAY'),
    at: '18:00',
    title: L('Тренировка', 'Gym session'),
    countdown: '8:47',
    day: [
      { at: '18:00', title: L('Тренировка', 'Gym session') },
      { at: '19:30', title: L('Урок языка', 'Language lesson') },
    ],
    sync: L('личный календарь · Telegram live', 'personal calendar · Telegram live'),
  },
  tabs: ['overview', 'areas', 'payments', 'court', 'work', 'mail', 'telegram'],
  panels: [
    panel(
      'personal-priority',
      'overview',
      L('Приоритет', 'Priority'),
      [
        task('personal-p1', L('Оплатить счёт за электричество', 'Pay the electricity bill'), {
          meta: L('Деньги', 'Money'),
          due: due(OVERDUE, 'danger'),
          priority: true,
        }),
        task('personal-p2', L('Позвонить в клинику, чтобы перенести приём', 'Call the clinic to move the appointment'), {
          meta: L('Здоровье', 'Health'),
          due: due(TODAY, 'warn'),
          priority: true,
        }),
        task('personal-p3', L('Отправить подписанную форму', 'Send the signed form back'), {
          meta: L('Бумаги', 'Paperwork'),
          due: due(L('чт 26 ноя', 'Thu 26 Nov'), 'warn'),
          priority: true,
        }),
      ],
      { priority: true, showCount: true },
    ),
    panel(
      'personal-week',
      'overview',
      L('Эта неделя', 'This week'),
      [
        task('personal-w1', L('Согласовать цену с тренером', 'Agree the price with the trainer'), { meta: L('Здоровье', 'Health') }),
        task('personal-w2', L('Выставить инвойс', 'Send the invoice'), {
          meta: L('Деньги', 'Money'),
          due: due(L('ср 25 ноя', 'Wed 25 Nov'), 'warn'),
        }),
        task('personal-w3', L('Собрать документы в одну папку', 'Put the documents in one folder'), { meta: L('Бумаги', 'Paperwork') }),
        task('personal-w4', L('Забронировать столик на субботу', 'Book a table for Saturday'), {
          meta: L('Отношения', 'Relationships'),
          due: due(L('сб 28 ноя', 'Sat 28 Nov')),
        }),
      ],
      { showCount: true },
    ),
    panel('personal-areas', 'areas', L('Сферы', 'Life areas'), [], {
      note: L('открытых задач', 'open tasks'),
      tiles: [
        { id: 'money', name: L('Деньги', 'Money'), count: 4, tone: 'green' },
        { id: 'work', name: L('Работа и доход', 'Work and income'), count: 2, tone: 'blue' },
        { id: 'paperwork', name: L('Бумаги', 'Paperwork'), count: 3, tone: 'violet' },
        { id: 'health', name: L('Здоровье и спорт', 'Health and sport'), count: 3, tone: 'red' },
        { id: 'relationships', name: L('Отношения', 'Relationships'), count: 1, tone: 'pink' },
        { id: 'friends', name: L('Друзья', 'Friends'), count: 0, tone: 'orange' },
        { id: 'family', name: L('Семья', 'Family'), count: 1, tone: 'amber' },
        { id: 'travel', name: L('Путешествия', 'Travel'), count: 2, tone: 'teal' },
        { id: 'home', name: L('Дом', 'Home'), count: 0, tone: 'accent' },
        { id: 'hobbies', name: L('Хобби и рост', 'Hobbies and growth'), count: 2, tone: 'ink' },
      ],
    }),
    panel(
      'personal-later',
      'areas',
      L('Потом', 'Later'),
      [
        task('personal-l1', L('Продлить загранпаспорт', 'Renew the passport'), { meta: L('Бумаги', 'Paperwork') }),
        task('personal-l2', L('Проверить статус заявки', 'Check the application status'), {
          meta: L('Бумаги', 'Paperwork'),
          due: due(L('1 дек', '1 Dec')),
        }),
        task('personal-l3', L('Выписать расходы за 3 месяца', 'List the last 3 months of spending'), { meta: L('Деньги', 'Money') }),
      ],
      { showCount: true },
    ),
    panel('personal-payments', 'payments', L('Платежи и дедлайны', 'Payments and deadlines'), [
      info('personal-pay1', L('Счёт за электричество', 'Electricity bill'), { meta: L('£120', '£120'), due: due(OVERDUE, 'danger') }),
      info('personal-pay2', L('Бухгалтер: ответ по оплате', 'Accountant: answer on fees'), { due: due(L('чт 26 ноя', 'Thu 26 Nov'), 'warn') }),
      info('personal-pay3', L('Поездка на выходные: решить, едем ли', 'Weekend trip: decide whether to go'), {
        meta: L('~£400', '~£400'),
        due: due(L('15 дек', '15 Dec')),
      }),
      info('personal-pay4', L('Страховка: добавить члена семьи', 'Insurance: add a family member'), {
        meta: L('£50/мес', '£50/mo'),
        due: due(L('1 янв', '1 Jan')),
      }),
    ]),
    panel('personal-court-dates', 'court', L('Ближайшие сроки', 'Next dates'), [
      info('personal-court1', L('Ответ юриста по оплате', 'Solicitor’s answer on fees'), {
        meta: L('если тишина, звонить', 'call if there is no answer'),
        due: due(L('чт 26 ноя', 'Thu 26 Nov'), 'warn'),
      }),
      info('personal-court2', L('Предварительное слушание (пример)', 'Preliminary hearing (example)'), {
        meta: L('лично, прийти заранее', 'in person, arrive early'),
        due: due(L('5 окт 2027', '5 Oct 2027')),
      }),
      info('personal-court3', L('Основное слушание (пример)', 'Main hearing (example)'), {
        meta: L('лично', 'in person'),
        due: due(L('8–11 ноя 2027', '8–11 Nov 2027')),
      }),
    ]),
    panel('personal-court-todo', 'court', L('Что сделать', 'To do'), [
      task('personal-ct1', L('Разложить новые файлы по папкам', 'File the new documents into folders'), { meta: L('18 файлов', '18 files') }),
      task('personal-ct2', L('Согласовать дату встречи с адвокатом', 'Agree the meeting date with counsel')),
      task('personal-ct3', L('Проверить комплект документов заранее', 'Check the document bundle in advance'), {
        due: due(L('21 сен 2027', '21 Sep 2027')),
      }),
    ]),
    panel('personal-court-pay', 'court', L('Платежи по делу', 'Case payments'), [
      info('personal-cp1', L('Консультация', 'Consultation'), { meta: L('£1,000', '£1,000'), due: due(L('Q3 2027', 'Q3 2027')) }),
      info('personal-cp2', L('Подготовка', 'Preparation'), { meta: L('£2,000', '£2,000'), due: due(L('Q4 2027', 'Q4 2027')) }),
      info('personal-cp3', L('Слушание', 'Hearing'), { meta: L('£5,000', '£5,000'), due: due(L('Q4 2027', 'Q4 2027')) }),
    ]),
    panel('personal-court-people', 'court', L('Люди', 'People'), [
      info('personal-cpl1', L('Адвокат A', 'Counsel A'), { meta: L('ведёт дело', 'leads the case'), action: act('mail', 'ask') }),
      info('personal-cpl2', L('Клерк A', 'Clerk A'), { meta: L('оплата и даты', 'fees and dates'), action: act('mail', 'ask') }),
      info('personal-cpl3', L('Юрист другой стороны', 'The other side’s solicitor'), {
        meta: L('только через своих юристов', 'only through your own lawyers'),
      }),
    ]),
    panel('personal-contracts', 'work', L('Контракты', 'Contracts'), [
      info('personal-wk1', L('Клиент A', 'Client A'), { meta: L('основной', 'main'), due: due(L('идёт', 'active')) }),
      info('personal-wk2', L('Клиент B', 'Client B'), {
        meta: L('ждём ответ по продлению', 'waiting for the extension answer'),
        due: due(L('до пт 27 ноя', 'by Fri 27 Nov'), 'warn'),
      }),
      info('personal-wk3', L('Клиент C', 'Client C'), { meta: L('поиск с февраля', 'search from February'), due: due(L('к апрелю', 'by April')) }),
    ]),
    panel('personal-search', 'work', L('Поиск работы', 'Job search'), [
      info('personal-js1', L('3 автоматизации поиска', '3 search automations'), {
        meta: L('рассылки, почта, рекрутеры', 'job boards, mail, recruiters'),
        due: due(L('на паузе', 'paused')),
      }),
      task('personal-js2', L('Оптимизировать поиск работы', 'Optimise the job search'), { due: due(L('скоро', 'soon')) }),
      task('personal-js3', L('Обновить CV', 'Update the CV')),
    ]),
    panel('personal-leads', 'work', L('Лиды', 'Leads'), [
      info('personal-ld1', L('Здесь появятся лиды: компания, ставка, статус, следующий шаг', 'Leads will appear here: company, rate, status, next step'), {
        meta: L('пока пусто', 'empty for now'),
      }),
    ]),
    panel('personal-mail-reply', 'mail', L('Нужен твой ответ', 'Needs your reply'), [
      info('personal-m1', L('Клиника: подтвердить запись до среды', 'Clinic: confirm the appointment by Wednesday'), {
        meta: L('Почта 1 · вчера', 'Mail 1 · yesterday'),
        due: due(L('ср 25 ноя', 'Wed 25 Nov'), 'warn'),
        action: act('mail'),
      }),
      info('personal-m2', L('Бухгалтер: вопрос по графику платежей', 'Accountant: a question about the payment schedule'), {
        meta: L('Почта 1 · 2 ч назад', 'Mail 1 · 2 h ago'),
        action: act('mail'),
      }),
      info('personal-m3', L('Запрос на консультацию с сайта', 'Consultation request from the website'), {
        meta: L('Почта 3 · сегодня', 'Mail 3 · today'),
        action: act('mail'),
      }),
    ]),
    panel('personal-mail-raised', 'mail', L('Поднято в задачи', 'Raised into tasks'), [
      info('personal-mr1', L('Счёт за электричество: финальное уведомление', 'Electricity bill: final notice'), {
        meta: L('стало дедлайном в «Платежи»', 'became a deadline in Payments'),
        due: due(OVERDUE, 'danger'),
      }),
      info('personal-mr2', L('Заявка: обновление статуса', 'Application: status update'), {
        meta: L('стало задачей в «Бумаги»', 'became a task in Paperwork'),
      }),
    ]),
    panel('personal-mail-junk', 'mail', L('Агент убрал бы', 'The agent would remove'), [
      info('personal-mj1', L('12 новых вакансий для вас', '12 new jobs for you'), {
        meta: L('Почта 2 · рассылка', 'Mail 2 · newsletter'),
        badge: L('мусор', 'junk'),
        action: act('mail', 'restore'),
      }),
      info('personal-mj2', L('Скидки недели', 'Deals of the week'), {
        meta: L('Почта 1 · реклама', 'Mail 1 · promo'),
        badge: L('мусор', 'junk'),
        action: act('mail', 'restore'),
      }),
      info('personal-mj3', L('Ваш еженедельный дайджест', 'Your weekly digest'), {
        meta: L('Почта 2 · рассылка', 'Mail 2 · newsletter'),
        badge: L('в дайджест', 'to digest'),
        action: act('mail', 'restore'),
      }),
    ]),
    panel(
      'personal-inbox',
      'telegram',
      L('Входящие', 'Inbox'),
      [
        info('personal-tg1', L('Напомни в пятницу забрать посылку', 'Remind me on Friday to pick up the parcel'), {
          meta: L('Telegram · голос', 'Telegram · voice'),
          action: act('telegram'),
        }),
        info('personal-tg2', L('Письмо от клиники: подтвердить запись', 'Clinic email: confirm the booking'), {
          meta: L('Telegram · пересылка', 'Telegram · forward'),
          action: act('telegram', 'open'),
        }),
        info('personal-tg3', L('Идея: тест уровня для приложения по языку', 'Idea: a level test for the language app'), {
          meta: L('заметка', 'note'),
        }),
      ],
      { note: L('3 не разобрано', '3 to sort') },
    ),
  ],
};

const WORK_1: SpaceData = {
  id: 'work-1',
  about: L('PR и ревью, тикеты Linear, action items со встреч.', 'PRs and reviews, Linear tickets, action items from meetings.'),
  quickAddPlaceholder: L('добавить задачу в «Работа 1»…', 'add a Work 1 task…'),
  hero: {
    label: L('СЛЕДУЮЩАЯ ВСТРЕЧА', 'NEXT MEETING'),
    at: '10:00',
    title: L('Стендап команды', 'Team stand-up'),
    countdown: '47:51',
    join: true,
    day: [
      { at: '10:00', title: L('Стендап команды', 'Team stand-up') },
      { at: '13:00', title: L('Онбординг-синк', 'Onboarding sync') },
    ],
    sync: L('GitHub 2 мин · Linear 9 мин · заметки 3 ч', 'GitHub 2 min · Linear 9 min · notes 3 h'),
  },
  tabs: ['overview', 'github', 'linear', 'slack', 'notion', 'posthog', 'grafana', 'meetings'],
  panels: [
    panel(
      'work-1-priority',
      'overview',
      L('Приоритет', 'Priority'),
      [
        task('work-1-p1', L('Ревью #123: пример изменения', 'Review #123: Example change'), {
          meta: L('PR', 'PR'),
          due: due(TODAY, 'warn'),
          priority: true,
        }),
        task('work-1-p2', L('Смержить PR с документацией и проверить staging', 'Merge the docs PRs and check staging'), {
          meta: L('Стендап, ср', 'Stand-up, Wed'),
          due: due(TODAY, 'warn'),
          priority: true,
        }),
      ],
      { priority: true, showCount: true },
    ),
    panel(
      'work-1-waiting',
      'overview',
      L('Меня ждут', 'Waiting on me'),
      [
        info('work-1-w1', L('Коллега A: ответить в треде ревью по #124', 'Colleague A: reply in the #124 review thread'), {
          meta: L('Slack · 20 мин назад', 'Slack · 20 min ago'),
          action: act('slack'),
        }),
        info('work-1-w2', L('Коллега B ждёт ответ на комментарий в #125', 'Colleague B is waiting for a reply to a comment on #125'), {
          meta: L('GitHub · 1 ч назад', 'GitHub · 1 h ago'),
          action: act('github'),
        }),
        info('work-1-w3', L('Коллега C: смержить master в #126', 'Colleague C: merge master into #126'), {
          meta: L('Slack · вчера', 'Slack · yesterday'),
          action: act('slack'),
        }),
      ],
      { showCount: true },
    ),
    panel(
      'work-1-review',
      'github',
      L('Ждут моего ревью', 'Waiting for my review'),
      [
        pr('work-1-r1', '#123', L('[EX-101] Example change: add the checks', 'Example change: add the checks'), 'fail', {
          badge: L('Ждёт ревью', 'Needs review'),
          badgeTone: 'accent',
          meta: L('1 мин', '1 min'),
        }),
        pr('work-1-r2', '#127', L('[EX-102] Keep the date of a record', 'Keep the date of a record'), 'pass', {
          badge: L('Ждёт ревью', 'Needs review'),
          badgeTone: 'accent',
          meta: L('11 мин', '11 min'),
        }),
        pr('work-1-r3', '#128', L('[EX-103] Page misses live updates while loading', 'Page misses live updates while loading'), 'pass', {
          badge: L('Ждёт ревью', 'Needs review'),
          badgeTone: 'accent',
          meta: L('1 ч', '1 h'),
        }),
      ],
      { showCount: true },
    ),
    panel(
      'work-1-mine',
      'github',
      L('Мои PR', 'My PRs'),
      [
        pr('work-1-m1', '#124', L('[EX-104] Settings are fixed in code', 'Settings are fixed in code'), 'fail', {
          badge: L('CI красный', 'CI failing'),
          badgeTone: 'neutral',
          meta: L('12 ч', '12 h'),
        }),
        pr('work-1-m2', '#125', L('[EX-105] Evals: three cases from real failures', 'Evals: three cases from real failures'), 'pass', {
          badge: L('Есть комментарии', 'Has comments'),
          badgeTone: 'neutral',
          meta: L('32 мин', '32 min'),
        }),
      ],
      { showCount: true },
    ),
    panel('work-1-comments', 'github', L('Комментарии ко мне', 'Comments addressed to me'), [
      info('work-1-c1', L('Коллега B: вопрос по порогам в #125', 'Colleague B: a question about thresholds in #125'), {
        meta: L('1 ч назад', '1 h ago'),
        action: act('github'),
      }),
      info('work-1-c2', L('Коллега A: запросил изменения в #124', 'Colleague A: requested changes on #124'), {
        meta: L('12 ч назад', '12 h ago'),
        action: act('github'),
      }),
    ]),
    panel('work-1-linear', 'linear', L('Мои тикеты', 'My tickets'), [
      info('work-1-l1', L('EX-105 Evals', 'EX-105 Evals'), { due: due(L('In Progress', 'In Progress'), 'warn') }),
      info('work-1-l2', L('EX-104 Settings fixed in code', 'EX-104 Settings fixed in code'), { due: due(L('In Review', 'In Review')) }),
      info('work-1-l3', L('EX-106 Latency measurements', 'EX-106 Latency measurements'), { due: due(L('Todo', 'Todo')) }),
    ]),
    panel('work-1-slack-reply', 'slack', L('Ответить', 'Reply'), [
      info('work-1-s1', L('Коллега A: тред ревью по #124', 'Colleague A: the #124 review thread'), {
        meta: L('20 мин назад', '20 min ago'),
        action: act('slack'),
      }),
      info('work-1-s2', L('Коллега C: смержить master в #126', 'Colleague C: merge master into #126'), {
        meta: L('вчера', 'yesterday'),
        action: act('slack'),
      }),
      info('work-1-s3', L('Коллега D: когда покажешь результаты оценки', 'Colleague D: when will you show the evaluation results'), {
        meta: L('вчера', 'yesterday'),
        action: act('slack'),
      }),
    ]),
    panel('work-1-slack-ask', 'slack', L('Спросить', 'Ask'), [
      task('work-1-sa1', L('Коллега E: бюджет кэша для страниц (EX-107)', 'Colleague E: budget for the page cache (EX-107)'), {
        action: act('slack', 'ask'),
      }),
      task('work-1-sa2', L('Коллега B: ревью алертов (#129)', 'Colleague B: review of the alerts (#129)'), {
        action: act('slack', 'ask'),
      }),
    ]),
    panel('work-1-notion', 'notion', L('Документы', 'Documents'), [
      info('work-1-n1', L('Спецификация: замена компонента — прочитать', 'Spec: replacing a component — read it'), {
        meta: L('обновлено 2 ч назад', 'updated 2 h ago'),
        action: act('notion', 'open'),
      }),
      info('work-1-n2', L('Заметки стендапа', 'Stand-up notes'), { meta: L('сегодня', 'today'), action: act('notion', 'open') }),
    ]),
    panel('work-1-posthog', 'posthog', L('Флаги', 'Feature flags'), [
      info('work-1-ph1', L('example_flag_a', 'example_flag_a'), { meta: L('production', 'production'), due: due(L('0%', '0%'), 'warn') }),
      info('work-1-ph2', L('example_flag_b', 'example_flag_b'), { meta: L('production', 'production'), due: due(L('100%', '100%')) }),
    ]),
    panel('work-1-grafana', 'grafana', L('Логи и алерты', 'Logs and alerts'), [
      info('work-1-g1', L('Фоновая задача: ошибки с 1 ноября (EX-108)', 'Background job: errors since 1 November (EX-108)'), {
        meta: L('Логи', 'Logs'),
        action: act('grafana', 'open'),
      }),
      info('work-1-g2', L('Новые алерты ещё не проверены (#129)', 'The new alerts are not verified yet (#129)'), {
        meta: L('Алерты', 'Alerts'),
        action: act('grafana', 'open'),
      }),
    ]),
    panel(
      'work-1-meetings',
      'meetings',
      L('Из встреч', 'From meetings'),
      [
        task('work-1-mt1', L('Посмотреть видео: быстрый и обычный режим', 'Watch the video: fast vs standard mode'), {
          meta: L('Синк 1:1 · чт', '1:1 sync · Thu'),
        }),
        task('work-1-mt2', L('Упростить конфигурацию в репозитории', 'Simplify the configuration in the repo'), {
          meta: L('Daily sync · пн', 'Daily sync · Mon'),
        }),
        task('work-1-mt3', L('Показать результаты оценки коллеге D', 'Show the evaluation results to Colleague D'), {
          meta: L('Стендап · чт', 'Stand-up · Thu'),
        }),
      ],
      { note: L('заметки · звонки', 'notes · calls') },
    ),
  ],
};

const WORK_2: SpaceData = {
  id: 'work-2',
  about: L('Только то, что вписано вручную. Ничего не синкается.', 'Only what is entered by hand. Nothing is synced here.'),
  quickAddPlaceholder: L('добавить задачу в «Работа 2»…', 'add a Work 2 task…'),
  hero: {
    label: L('СЛЕДУЮЩАЯ ВСТРЕЧА', 'NEXT MEETING'),
    at: '15:30',
    title: L('Синк по проекту', 'Project sync'),
    countdown: '6:17',
    day: [{ at: '15:30', title: L('Синк по проекту', 'Project sync') }],
    sync: L('только ручной ввод · без синка', 'manual entry only · no sync'),
  },
  tabs: ['overview', 'github', 'jira', 'teams'],
  panels: [
    panel(
      'work-2-priority',
      'overview',
      L('Приоритет', 'Priority'),
      [
        task('work-2-p1', L('Продление контракта: дожать ответ', 'Contract extension: chase the answer'), {
          meta: L('Контракт', 'Contract'),
          due: due(L('до пт 27 ноя', 'by Fri 27 Nov'), 'warn'),
          priority: true,
        }),
      ],
      { priority: true, showCount: true },
    ),
    panel(
      'work-2-week',
      'overview',
      L('Эта неделя', 'This week'),
      [
        task('work-2-w1', L('Посмотреть PR от команды', 'Review the team’s PRs'), { due: due(TODAY, 'warn') }),
        task('work-2-w2', L('Обновить токен доступа до истечения', 'Renew the access token before it expires'), {
          due: due(L('ср 25 ноя', 'Wed 25 Nov')),
        }),
      ],
      { showCount: true },
    ),
    panel(
      'work-2-later',
      'overview',
      L('Потом', 'Later'),
      [task('work-2-l1', L('Заполнить timesheet за ноябрь', 'Fill in the November timesheet'), { due: due(L('30 ноя', '30 Nov')) })],
      { showCount: true },
    ),
    panel('work-2-github', 'github', L('PR', 'PRs'), [
      task('work-2-g1', L('PR #83 и #84: решить, сливать ли в один', 'PRs #83 and #84: decide whether to merge them into one'), {
        meta: L('вручную', 'manual'),
      }),
      info('work-2-g2', L('PR #82', 'PR #82'), { meta: L('вручную', 'manual'), due: due(L('зелёный', 'green')) }),
    ]),
    panel('work-2-jira', 'jira', L('Тикеты', 'Tickets'), [
      task('work-2-j1', L('EX-2115: повторный скан', 'EX-2115: re-scan'), { meta: L('вручную', 'manual') }),
    ]),
    panel('work-2-teams-reply', 'teams', L('Ответить', 'Reply'), [
      task('work-2-t1', L('Отправить план стейкхолдерам', 'Send the plan to the stakeholders'), {
        meta: L('вручную', 'manual'),
        action: act('teams'),
      }),
    ]),
    panel('work-2-teams-ask', 'teams', L('Спросить', 'Ask'), [
      task('work-2-t2', L('Доступ к стенду: кто может подтвердить', 'Test environment access: who can confirm it'), {
        meta: L('вручную', 'manual'),
        action: act('teams', 'ask'),
      }),
    ]),
  ],
};

export const SAMPLE_SPACES: Record<SpaceId, SpaceData> = { personal: PERSONAL, 'work-1': WORK_1, 'work-2': WORK_2 };

const ev = (
  id: string,
  days: readonly number[],
  start: string,
  end: string,
  title: Localized,
  space: SpaceId,
  note?: Localized,
): WeekEvent[] => days.map((day) => ({ id: `${id}-${day}`, day, start, end, title, space, note }));

export const SAMPLE_WEEK: WeekData = {
  range: L('23–29 ноября', '23–29 November'),
  days: [
    { label: L('Пн 23', 'Mon 23'), today: true },
    { label: L('Вт 24', 'Tue 24') },
    { label: L('Ср 25', 'Wed 25') },
    { label: L('Чт 26', 'Thu 26') },
    { label: L('Пт 27', 'Fri 27') },
    { label: L('Сб 28', 'Sat 28') },
    { label: L('Вс 29', 'Sun 29') },
  ],
  hours: Array.from({ length: 12 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`),
  events: [
    ...ev('standup', [0, 1, 2, 3, 4], '10:00', '10:30', L('Стендап команды', 'Team stand-up'), 'work-1'),
    ...ev('onboarding', [0, 2], '13:00', '14:00', L('Онбординг-синк', 'Onboarding sync'), 'work-1'),
    ...ev('project', [0, 3], '15:30', '16:30', L('Синк по проекту', 'Project sync'), 'work-2'),
    ...ev('gym', [0, 2, 4], '18:00', '19:00', L('Тренировка', 'Gym session'), 'personal'),
    ...ev('lesson', [0, 1, 3], '19:30', '20:30', L('Урок языка', 'Language lesson'), 'personal'),
    ...ev('doctor', [2], '11:00', '12:00', L('Врач', 'Doctor'), 'personal', L('в «Работа 1» видно как Focus time', 'shows in Work 1 as Focus time')),
    ...ev('call', [3], '14:00', '14:30', L('Звонок юристу', 'Call the solicitor'), 'personal', L('в «Работа 1» видно как Focus time', 'shows in Work 1 as Focus time')),
    ...ev('dinner', [5], '19:00', '21:00', L('Ужин вне дома', 'Dinner out'), 'personal'),
    // Two events of different spaces overlap: a conflict.
    ...ev('planning', [1], '14:00', '15:00', L('Планирование', 'Planning session'), 'work-1'),
    ...ev('status', [1], '14:30', '15:30', L('Статус-созвон', 'Status call'), 'work-2'),
    // Three events of three spaces overlap each other: three conflicts, three columns.
    ...ev('workshop', [4], '15:00', '17:00', L('Воркшоп', 'Workshop'), 'work-1'),
    ...ev('dentist', [4], '15:30', '16:30', L('Стоматолог', 'Dentist'), 'personal'),
    ...ev('vendor', [4], '16:00', '16:45', L('Звонок поставщику', 'Vendor call'), 'work-2'),
    // Two events of one space overlap: side by side, not a conflict.
    ...ev('review', [2], '16:00', '17:00', L('Ревью кода', 'Code review'), 'work-1'),
    ...ev('pairing', [2], '16:30', '17:30', L('Парная работа', 'Pairing'), 'work-1'),
    // A 15-minute event next to a long one (same space).
    ...ev('lunch', [3], '12:00', '13:00', L('Обед', 'Lunch'), 'personal'),
    ...ev('parcel', [3], '12:15', '12:30', L('Забрать посылку', 'Pick up the parcel'), 'personal'),
  ],
};
