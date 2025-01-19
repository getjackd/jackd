interface CamelCaseOptions {
    pascalCase?: boolean;
    preserveConsecutiveUppercase?: boolean;
    locale?: string | false;
}
export default function camelCase(input: string | string[], options?: CamelCaseOptions): string;
export {};
