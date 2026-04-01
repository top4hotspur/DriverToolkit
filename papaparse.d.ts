declare module "papaparse" {
  interface ParseConfig {
    header?: boolean;
    skipEmptyLines?: boolean | "greedy";
    transformHeader?: (header: string) => string;
    dynamicTyping?: boolean;
  }

  interface ParseResult<T> {
    data: T[];
    errors: Array<{ message: string }>;
    meta: { fields?: string[] };
  }

  function parse<T = Record<string, string>>(input: string, config?: ParseConfig): ParseResult<T>;

  const Papa: {
    parse: typeof parse;
  };

  export default Papa;
}
