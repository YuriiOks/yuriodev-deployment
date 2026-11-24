/** The words of the banks entered by hand: a balance with a date, and an uploaded statement checked before it is imported (both languages). */
export interface ManualStrings {
  readonly balanceAsOf: string;
  readonly updateBalance: string;
  readonly uploadStatement: string;
  readonly fBalance: string;
  readonly fOwed: string;
  readonly fAsOf: string;
  readonly asOfHint: string;
  readonly saveBalance: string;
  readonly balanceInvalid: string;
  readonly balanceFailed: string;
  readonly fFile: string;
  readonly fileHint: string;
  readonly fDateOrder: string;
  readonly dateAuto: string;
  readonly dateDmy: string;
  readonly dateMdy: string;
  readonly applyBalance: string;
  readonly checkFile: string;
  readonly checking: string;
  readonly importFile: string;
  readonly importing: string;
  readonly noFile: string;
  readonly checkNote: string;
  readonly importedNote: string;
  readonly layoutLine: string;
  readonly parsedLine: string;
  readonly createdLine: string;
  readonly duplicatesLine: string;
  readonly rangeLine: string;
  readonly moneyInLine: string;
  readonly moneyOutLine: string;
  readonly balanceApplied: string;
  readonly errorsTitle: string;
  readonly errorLine: string;
  readonly uploadRefused: string;
  readonly uploadFailed: string;
  readonly close: string;
}

export const MANUAL_RU: ManualStrings = {
  balanceAsOf: 'баланс на {date}',
  updateBalance: 'Обновить баланс',
  uploadStatement: 'Загрузить выписку',
  fBalance: 'Баланс',
  fOwed: 'Долг по карте',
  fAsOf: 'На дату',
  asOfHint: 'Пусто: на сейчас',
  saveBalance: 'Сохранить баланс',
  balanceInvalid: 'Введите сумму вроде 1234.50',
  balanceFailed: 'Не удалось сохранить баланс. Повторите.',
  fFile: 'Файл выписки',
  fileHint: 'OFX, QFX или CSV',
  fDateOrder: 'Порядок даты',
  dateAuto: 'По файлу',
  dateDmy: 'Сначала день (31/12/2026)',
  dateMdy: 'Сначала месяц (12/31/2026)',
  applyBalance: 'Взять баланс из файла',
  checkFile: 'Проверить файл',
  checking: 'Читаю файл…',
  importFile: 'Загрузить',
  importing: 'Загружаю…',
  noFile: 'Выберите файл выписки.',
  checkNote: 'Пока ничего не сохранено: сверьте цифры с выпиской банка.',
  importedNote: 'Загружено.',
  layoutLine: 'Формат: {layout}',
  parsedLine: 'Строк прочитано: {n}',
  createdLine: 'Новых: {n}',
  duplicatesLine: 'Уже были: {n}',
  rangeLine: 'С {from} по {to}',
  moneyInLine: 'Поступило: {amount}',
  moneyOutLine: 'Списано: {amount}',
  balanceApplied: 'Баланс взят из файла',
  errorsTitle: 'Строки, которые нужно исправить ({n})',
  errorLine: 'Строка {row}: {message}',
  uploadRefused: 'Файл не принят: {why}',
  uploadFailed: 'Не удалось загрузить файл. Повторите.',
  close: 'Закрыть',
};

export const MANUAL_EN: ManualStrings = {
  balanceAsOf: 'balance as of {date}',
  updateBalance: 'Update balance',
  uploadStatement: 'Upload statement',
  fBalance: 'Balance',
  fOwed: 'Owed on the card',
  fAsOf: 'As of',
  asOfHint: 'Empty: now',
  saveBalance: 'Save balance',
  balanceInvalid: 'Enter an amount like 1234.50',
  balanceFailed: 'Could not save the balance. Try again.',
  fFile: 'Statement file',
  fileHint: 'OFX, QFX or CSV',
  fDateOrder: 'Date order',
  dateAuto: 'From the file',
  dateDmy: 'Day first (31/12/2026)',
  dateMdy: 'Month first (12/31/2026)',
  applyBalance: 'Also set the balance from the file',
  checkFile: 'Check the file',
  checking: 'Reading the file…',
  importFile: 'Import',
  importing: 'Importing…',
  noFile: 'Choose a statement file.',
  checkNote: 'Nothing is saved yet: check these against your bank\'s own statement.',
  importedNote: 'Imported.',
  layoutLine: 'Format: {layout}',
  parsedLine: 'Lines read: {n}',
  createdLine: 'New: {n}',
  duplicatesLine: 'Already there: {n}',
  rangeLine: 'From {from} to {to}',
  moneyInLine: 'Money in: {amount}',
  moneyOutLine: 'Money out: {amount}',
  balanceApplied: 'The balance was set from the file',
  errorsTitle: 'Lines to fix ({n})',
  errorLine: 'Line {row}: {message}',
  uploadRefused: 'The file was refused: {why}',
  uploadFailed: 'Could not upload the file. Try again.',
  close: 'Close',
};
