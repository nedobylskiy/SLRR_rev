export type TelemetryRow = Record<string, string>;
export interface TelemetryRun {
  key: string; id: string; metadata: TelemetryRow; model: string;
  engine: TelemetryRow; ratios: TelemetryRow[]; curves: TelemetryRow[];
  samples: TelemetryRow[]; shifts: TelemetryRow[]; ended: boolean;
}
export interface TelemetryReport {
  version: number; runs: TelemetryRun[]; rejected: number; warnings: string[]; limitations: string[];
}
export function parseTelemetry(text: string): TelemetryReport;
export function compareTelemetry(reference: TelemetryReport, candidate: TelemetryReport): {
  matched: { model: string; configuration: unknown[]; shifts: {change: string; deltaRPM: number}[];
    torque: {rpm: number; referenceNm: number; candidateNm: number; deltaNm: number}[] }[];
  unmatchedReferenceConfigurations: number; unmatchedCandidateConfigurations: number; note: string;
};
export function stageTelemetry(gameRoot: string, output: string): Promise<Record<string, unknown>>;
