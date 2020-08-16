declare module "random-words" {
  export interface RandomWordListOptions {
    /** Minimum number of words to generate */
    min?: number;
    /** Maximum number of words to generate */
    max?: number;
    /** Exact number of words to generate */
    exactly?: number;

    /** Maximum length each random word can have */
    maxLength?: number;

    wordsPerString?: number;
    separator?: string;

    formatter?: (string) => string;
  }

  export interface RandomWordStringOptions extends RandomWordListOptions {
    join: string;
  }

  /**
   * Generates a list of random words.
   */
  declare function randomWords(
    listOptions?: RandomWordListOptions | number,
  ): string[];
  /**
   * Generates a string of random words joined by `join`.
   */
  declare function randomWords(stringOptions: RandomWordStringOptions): string;

  export default randomWords;
}
