import type { CodeFile } from "../contracts/code.ts";

import type {
  Capabilities,
  CapabilityStatus,
  Capability,
  SourceRange,
  LanguageSymbol,
  LanguageScope,
  LanguageRelationship,
  LanguageAnalysis,
  AnalysisReport,
} from "../contracts/language-analysis.ts";
export type {
  Capabilities,
  CapabilityStatus,
  Capability,
  SourceRange,
  LanguageSymbol,
  LanguageScope,
  LanguageRelationship,
  LanguageAnalysis,
  AnalysisReport,
};
export type AnalysisInput = {
  files: (CodeFile & { content: string })[];
  configuration?: { path: string; sha256: string }[];
};
export type AnalysisOutput = { files: CodeFile[]; analysis: AnalysisReport };
export interface LanguageAdapter {
  id: string;
  version: string;
  accepts(path: string): boolean;
  analyze(
    files: AnalysisInput["files"],
    context: string,
    options: {
                                                                  paths?: string[];
      configuration?: { path: string; sha256: string }[];
    },
  ): void;
}
export const analysisVersion = "language-boundary-1";
export const analysisLimits = {
  timeoutMs: 25000,
  outputBytes: 24 * 1024 * 1024,
  adapterBytes: 8 * 1024 * 1024,
  facts: 4000,
  totalFacts: 60000,
};
