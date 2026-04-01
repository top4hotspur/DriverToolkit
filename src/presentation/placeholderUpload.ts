import { UploadStatusViewModel } from "../domain/importTypes";

export const uploadStatusCopy = {
  acceptedFileTypes: [".zip"],
  idleTitle: "No file imported yet",
  idleDescription:
    "Choose your Uber privacy ZIP to refresh local decision intelligence. Processing stays on your device.",
  importingTitle: "Importing locally",
  importingDescription: "Reading ZIP, parsing trips, and calculating first-pass truth metrics.",
};

export function createIdleUploadStatus(): UploadStatusViewModel {
  return {
    phase: "idle",
    title: uploadStatusCopy.idleTitle,
    description: uploadStatusCopy.idleDescription,
    selectedFileName: null,
    result: null,
  };
}
