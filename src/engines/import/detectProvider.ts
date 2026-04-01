import { ProviderDetectionResult } from "../../domain/importTypes";

export function detectProviderFromZip(args: {
  fileName: string;
  fileType: "zip" | "csv";
  candidateCsvNames: string[];
}): ProviderDetectionResult {
  const lowerName = args.fileName.toLowerCase();
  const lowerCandidates = args.candidateCsvNames.map((name) => name.toLowerCase());

  const looksUber =
    lowerName.includes("uber") ||
    lowerCandidates.some((name) =>
      ["uber", "trip", "activity", "driving", "payment"].some((token) => name.includes(token)),
    );

  return {
    provider: looksUber ? "uber" : null,
    fileType: args.fileType,
    candidateCsvNames: args.candidateCsvNames,
    requiredDataFound: lowerCandidates.length > 0,
  };
}
