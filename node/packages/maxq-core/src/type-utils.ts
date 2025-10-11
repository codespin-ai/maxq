/* eslint-disable @typescript-eslint/no-explicit-any */
// Type utilities for string case conversion
type CamelCase<S extends string> =
  S extends `${infer P1}_${infer P2}${infer P3}`
    ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
    : Lowercase<S>;

type SnakeCase<S extends string> = S extends `${infer T}${infer U}`
  ? `${T extends Capitalize<T> ? "_" : ""}${Lowercase<T>}${SnakeCase<U>}`
  : S;

// Type for converting object keys to camelCase
type CamelCaseKeys<T> = T extends readonly any[]
  ? T
  : T extends object
    ? {
        [K in keyof T as CamelCase<K & string>]: T[K]; // Don't recurse into nested objects
      }
    : T;

// Type for converting object keys to snake_case
type SnakeCaseKeys<T> = T extends readonly any[]
  ? T
  : T extends object
    ? {
        [K in keyof T as SnakeCase<K & string>]: T[K]; // Don't recurse into nested objects
      }
    : T;

// Runtime function to convert string to camelCase
function stringToCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Runtime function to convert string to snake_case
function stringToSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

// Main function to convert object keys to camelCase
export function toCamelCase<T extends Record<string, any>>(
  obj: T,
): CamelCaseKeys<T> {
  if (Array.isArray(obj)) {
    return obj as any;
  }

  if (obj === null || typeof obj !== "object") {
    return obj as any;
  }

  const result: any = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = stringToCamelCase(key);
      // Don't recurse - just copy the value as-is
      result[camelKey] = obj[key];
    }
  }

  return result;
}

// Main function to convert object keys to snake_case
export function toSnakeCase<T extends Record<string, any>>(
  obj: T,
): SnakeCaseKeys<T> {
  if (Array.isArray(obj)) {
    return obj as any;
  }

  if (obj === null || typeof obj !== "object") {
    return obj as any;
  }

  const result: any = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const snakeKey = stringToSnakeCase(key);
      // Don't recurse - just copy the value as-is
      result[snakeKey] = obj[key];
    }
  }

  return result;
}
