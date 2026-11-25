/** What a refusal by the server is told as: the page's own words for each error code it sends (never the server's own text), and for a bad line of a statement. */
export interface RefusalStrings {
  /** By the server's error code; a code that is not here is told as the generic failure by the caller. */
  readonly codes: Readonly<Record<string, string>>;
  /** A statement line that could not be read, and the columns by the server's field id. */
  readonly line: string;
  readonly fields: Readonly<Record<string, string>>;
}

export const REFUSAL_RU: RefusalStrings = {
  codes: {
    validation_error: 'проверьте введённые значения',
    not_found: 'этого уже нет',
    conflict: 'оно уже есть или изменилось',
    too_large: 'файл слишком большой',
    unsupported_media_type: 'такой тип файла не принимается',
    empty_file: 'файл пустой',
    other_bank: 'похоже, файл от другого банка',
    unknown_layout: 'столбцы файла не распознаны',
  },
  line: 'не удалось прочитать',
  fields: { date: 'дата', amount: 'сумма', balance: 'баланс', description: 'описание', counterparty: 'получатель', currency: 'валюта' },
};

export const REFUSAL_EN: RefusalStrings = {
  codes: {
    validation_error: 'check the values you entered',
    not_found: 'it no longer exists',
    conflict: 'it already exists or has changed',
    too_large: 'the file is too large',
    unsupported_media_type: 'that kind of file is not accepted',
    empty_file: 'the file is empty',
    other_bank: 'the file looks like it is from another bank',
    unknown_layout: 'the columns of the file are not recognised',
  },
  line: 'could not be read',
  fields: { date: 'date', amount: 'amount', balance: 'balance', description: 'description', counterparty: 'payee', currency: 'currency' },
};
