// https://github.com/sindresorhus/camelcase/blob/main/index.js

const UPPERCASE = /[\p{Lu}]/u
const LOWERCASE = /[\p{Ll}]/u
const LEADING_CAPITAL = /^[\p{Lu}](?![\p{Lu}])/gu
const IDENTIFIER = /([\p{Alpha}\p{N}_]|$)/u
const SEPARATORS = /[_.\- ]+/

const LEADING_SEPARATORS = new RegExp("^" + SEPARATORS.source)
const SEPARATORS_AND_IDENTIFIER = new RegExp(
  SEPARATORS.source + IDENTIFIER.source,
  "gu"
)
const NUMBERS_AND_IDENTIFIER = new RegExp("\\d+" + IDENTIFIER.source, "gu")

interface CamelCaseOptions {
  pascalCase?: boolean
  preserveConsecutiveUppercase?: boolean
  locale?: string | false
}

type StringTransformer = (str: string) => string

const preserveCamelCase = (
  str: string,
  toLowerCase: StringTransformer,
  toUpperCase: StringTransformer,
  preserveConsecutiveUppercase: boolean
): string => {
  let isLastCharLower = false
  let isLastCharUpper = false
  let isLastLastCharUpper = false
  let isLastLastCharPreserved = false

  for (let index = 0; index < str.length; index++) {
    const character = str[index]
    isLastLastCharPreserved = index > 2 ? str[index - 3] === "-" : true

    if (isLastCharLower && UPPERCASE.test(character)) {
      str = str.slice(0, index) + "-" + str.slice(index)
      isLastCharLower = false
      isLastLastCharUpper = isLastCharUpper
      isLastCharUpper = true
      index++
    } else if (
      isLastCharUpper &&
      isLastLastCharUpper &&
      LOWERCASE.test(character) &&
      (!isLastLastCharPreserved || preserveConsecutiveUppercase)
    ) {
      str = str.slice(0, index - 1) + "-" + str.slice(index - 1)
      isLastLastCharUpper = isLastCharUpper
      isLastCharUpper = false
      isLastCharLower = true
    } else {
      isLastCharLower =
        toLowerCase(character) === character &&
        toUpperCase(character) !== character
      isLastLastCharUpper = isLastCharUpper
      isLastCharUpper =
        toUpperCase(character) === character &&
        toLowerCase(character) !== character
    }
  }

  return str
}

const preserveConsecutiveUppercase = (
  input: string,
  toLowerCase: StringTransformer
): string => {
  LEADING_CAPITAL.lastIndex = 0
  return input.replaceAll(LEADING_CAPITAL, match => toLowerCase(match))
}

const postProcess = (input: string, toUpperCase: StringTransformer): string => {
  SEPARATORS_AND_IDENTIFIER.lastIndex = 0
  NUMBERS_AND_IDENTIFIER.lastIndex = 0

  return input
    .replaceAll(
      NUMBERS_AND_IDENTIFIER,
      (match: string, _pattern: string, offset: number) =>
        ["_", "-"].includes(input.charAt(offset + match.length))
          ? match
          : toUpperCase(match)
    )
    .replaceAll(SEPARATORS_AND_IDENTIFIER, (_: string, identifier: string) =>
      toUpperCase(identifier)
    )
}

export default function camelCase(
  input: string | string[],
  options?: CamelCaseOptions
): string {
  if (!(typeof input === "string" || Array.isArray(input))) {
    throw new TypeError("Expected the input to be `string | string[]`")
  }

  options = {
    pascalCase: false,
    preserveConsecutiveUppercase: false,
    ...options
  }

  if (Array.isArray(input)) {
    input = input
      .map(x => x.trim())
      .filter(x => x.length)
      .join("-")
  } else {
    input = input.trim()
  }

  if (input.length === 0) {
    return ""
  }

  const toLowerCase: StringTransformer =
    options.locale === false
      ? (string: string) => string.toLowerCase()
      : (string: string) =>
          string.toLocaleLowerCase(
            options.locale as string | string[] | undefined
          )

  const toUpperCase: StringTransformer =
    options.locale === false
      ? (string: string) => string.toUpperCase()
      : (string: string) =>
          string.toLocaleUpperCase(
            options.locale as string | string[] | undefined
          )

  if (input.length === 1) {
    if (SEPARATORS.test(input)) {
      return ""
    }

    return options.pascalCase ? toUpperCase(input) : toLowerCase(input)
  }

  const hasUpperCase = input !== toLowerCase(input)

  if (hasUpperCase) {
    input = preserveCamelCase(
      input,
      toLowerCase,
      toUpperCase,
      options.preserveConsecutiveUppercase || false
    )
  }

  input = input.replace(LEADING_SEPARATORS, "")
  input = options.preserveConsecutiveUppercase
    ? preserveConsecutiveUppercase(input, toLowerCase)
    : toLowerCase(input)

  if (options.pascalCase) {
    input = toUpperCase(input.charAt(0)) + input.slice(1)
  }

  return postProcess(input, toUpperCase)
}
