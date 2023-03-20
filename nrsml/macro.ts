export interface Macro {
    generate(vars: Map<string, string>): Record<string, unknown>;
}