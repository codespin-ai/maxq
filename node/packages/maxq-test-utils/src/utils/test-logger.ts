/**
 * Test logger that respects VERBOSE_TESTS environment variable
 *
 * By default, tests run silently. Set VERBOSE_TESTS=true to see all logs.
 */

export type Logger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

const isVerbose = process.env.VERBOSE_TESTS === "true";

export const testLogger: Logger = {
  debug: isVerbose ? console.debug : () => {},
  info: isVerbose ? console.info : () => {},
  warn: isVerbose ? console.warn : () => {},
  error: isVerbose ? console.error : () => {},
};

// Logger that always outputs to console
export const consoleLogger: Logger = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
